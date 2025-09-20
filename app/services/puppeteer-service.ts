import puppeteer from 'puppeteer';
import { computeTimeout, sleep, waitForEnter } from '../helpers/bot-helper.ts';
import type { Response } from '../utils/error-handling-utils.ts';
import fs from 'fs/promises';

// --- File Paths for Session Data ---
const cookiesPath = './cookies.json';
const localStoragePath = './localStorage.json';
const sessionStoragePath = './sessionStorage.json';

// --- Interfaces for Structured Game Data ---
export interface Player {
  seat: number;
  name: string;
  stack: number;
  bet: number;
  isSelf: boolean;
  isDealer: boolean;
  isCurrentTurn: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  holeCards: string[];
}

export interface GameState {
  players: Player[];
  communityCards: string[];
  pot: number;
}

export class PuppeteerService {
  private default_timeout: number;
  private headless_flag: boolean;
  private browser!: puppeteer.Browser;
  private page!: puppeteer.Page;
  private observe_only: boolean = process.env.ADVISOR_OBSERVE === '1';

  // --- Session Management ---
  private async saveSession(): Promise<void> {
    try {
      const cookies = await this.page.cookies();
      await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
      console.log(`INFO: Saved ${cookies.length} cookies.`);
      const localStorageData = await this.page.evaluate(() => JSON.stringify(window.localStorage));
      await fs.writeFile(localStoragePath, localStorageData);
      console.log('INFO: Saved localStorage.');
      const sessionStorageData = await this.page.evaluate(() => JSON.stringify(window.sessionStorage));
      await fs.writeFile(sessionStoragePath, sessionStorageData);
      console.log('INFO: Saved sessionStorage.');
      console.log('SUCCESS: Full session has been saved.');
    } catch (error) {
      console.error('ERROR: Failed to save session:', error);
    }
  }

  private async loadSession(): Promise<void> {
    console.log('INFO: Attempting to load saved session...');
    const cookies = JSON.parse(await fs.readFile(cookiesPath, 'utf8'));
    await this.page.setCookie(...cookies);
    console.log(`INFO: Loaded and set ${cookies.length} cookies.`);
    const localStorageData = await fs.readFile(localStoragePath, 'utf8');
    await this.page.evaluate(data => {
      for (const [key, value] of Object.entries(JSON.parse(data))) {
        localStorage.setItem(key, value as string);
      }
    }, localStorageData);
    console.log('INFO: Loaded and set localStorage.');
    const sessionStorageData = await fs.readFile(sessionStoragePath, 'utf8');
    await this.page.evaluate(data => {
      for (const [key, value] of Object.entries(JSON.parse(data))) {
        sessionStorage.setItem(key, value as string);
      }
    }, sessionStorageData);
    console.log('INFO: Loaded and set sessionStorage.');
    console.log('SUCCESS: Full session has been loaded.');
  }

  private async isLoggedIn(): Promise<boolean> {
    const pokerFrame = this.pickPokerFrame(); 
    const loginCheckSelector = 'a[href="/sign_out"]';
    for (let i = 0; i < 10; i++) {
      const logoutButton = await pokerFrame.$(loginCheckSelector);
      if (logoutButton) return true;
      await sleep(500); 
    }
    return false;
  }

  private async manageLoginAndCookies(): Promise<void> {
    try {
      await this.page.goto('about:blank');
      await this.loadSession();
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'networkidle2' });
      console.log('INFO: Navigated to PokerNow with pre-loaded session.');
      console.log('INFO: Verifying login status using correct selector and polling...');
      const loggedIn = await this.isLoggedIn();
      if (loggedIn) {
          console.log('SUCCESS: Login confirmed. Session is valid.');
      } else {
          console.log('WARNING: Login verification failed. Session is stale or page did not render in time.');
          throw new Error('Stale session');
      }
    } catch (error) {
      console.log('WARNING: No valid session found. Falling back to manual login.');
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'networkidle2' });
      await waitForEnter('ACTION REQUIRED: Please log in to PokerNow in the browser, then press Enter in this console...');
      console.log('INFO: Resuming script and saving new session...');
      await this.saveSession();
    }
  }
    
  constructor(default_timeout: number, headless_flag: boolean) {
    this.default_timeout = default_timeout;
    this.headless_flag = headless_flag;
  }

  // --- Core Methods ---
  async init(): Promise<void> {
    const ws = (process.env.BROWSER_WS_ENDPOINT || '').trim();
    const httpBase = (process.env.BROWSER_URL || '').trim();
    try {
      if (ws && (ws.startsWith('ws://') || ws.startsWith('wss://'))) {
        this.browser = await puppeteer.connect({ browserWSEndpoint: ws });
      } else if (httpBase && (httpBase.startsWith('http://') || httpBase.startsWith('https://'))) {
        this.browser = await puppeteer.connect({ browserURL: httpBase });
      } else {
        this.browser = await puppeteer.launch({ defaultViewport: null, headless: this.headless_flag });
      }
    } catch (_e) {
        this.browser = await puppeteer.launch({ defaultViewport: null, headless: this.headless_flag });
    }
    const pages = await this.browser.pages();
    const pokerPage = pages.find(p => (p.url() || '').includes('pokernow.club'));
    this.page = pokerPage ? pokerPage : (await this.browser.newPage());
    
    this.page.on('pageerror', err => console.error('pageerror:', err));
    this.page.on('error', err => console.error('page crash/error:', err));
    this.page.on('console', msg => console.log(`[console:${msg.type()}] ${msg.text()}`));
    this.page.on('requestfailed', req => {
      const f = req.failure();
      console.warn('requestfailed:', req.url(), f ? f.errorText : undefined);
    });

    await this.page.setRequestInterception(true);
    this.page.on('request', (request) => {
      if (request.url().includes('google-analytics.com')) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await this.manageLoginAndCookies();
  }

  async closeBrowser(): Promise<void> {
    const ws = (process.env.BROWSER_WS_ENDPOINT || '').trim();
    if (ws) {
      this.browser.disconnect();
    } else {
      await this.browser.close();
    }
  }

  async navigateToGame(game_id: string): Promise<void> {
    if (!game_id) throw new Error('Game id cannot be empty.');
    await this.page.goto(`https://www.pokernow.club/games/${game_id}`, { waitUntil: 'networkidle2' });
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  // --- Consolidated Game State Scraping ---
  private pickPokerFrame(): puppeteer.Page | puppeteer.Frame {
    const frames = this.page.frames();
    const f = frames.find(fr => (fr.url() || '').includes('pokernow.club'));
    return f || this.page;
  }

  async getTableState(): Promise<GameState | null> {
    const pokerFrame = this.pickPokerFrame();
    try {
      const gameState = await pokerFrame.evaluate(() => {
        const parseValue = (text: string | null | undefined): number => {
          if (!text) return 0;
          const cleanedText = text.toLowerCase().trim();
          const k = cleanedText.indexOf('k');
          const m = cleanedText.indexOf('m');
          const num = parseFloat(cleanedText.replace(/[^0-9.]/g, ''));
          if (k > -1) return num * 1000;
          if (m > -1) return num * 1000000;
          return num;
        };
        const players: Player[] = Array.from(document.querySelectorAll('.table-player')).map(el => {
          const seat = parseInt(el.getAttribute('data-seat') || '0', 10);
          const name = (el.querySelector('.table-player-name') as HTMLElement)?.innerText || '';
          const stackText = (el.querySelector('.table-player-stack') as HTMLElement)?.innerText;
          const betText = (el.querySelector('.table-player-bet-value') as HTMLElement)?.innerText;
          const holeCards = Array.from(el.querySelectorAll('.table-player-cards .card')).map(cardEl => {
            const value = (cardEl.querySelector('.value') as HTMLElement)?.innerText || '';
            const suit = (cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText || '';
            return `${value}${suit}`;
          });
          return {
            seat,
            name,
            stack: parseValue(stackText),
            bet: parseValue(betText),
            isSelf: el.classList.contains('you-player'),
            isDealer: !!el.querySelector('.table-dealer-button'),
            isCurrentTurn: !!el.querySelector('.current-player-indicator'),
            isFolded: el.classList.contains('folded'),
            isAllIn: el.classList.contains('all-in'),
            holeCards: holeCards.filter(c => c.length === 2)
          };
        }).filter(p => p.name);
        const communityCards = Array.from(document.querySelectorAll('.table-community-cards .card')).map(cardEl => {
          const value = (cardEl.querySelector('.value') as HTMLElement)?.innerText || '';
          const suit = (cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText || '';
          return `${value}${suit}`;
        });
        const potText = (document.querySelector('.table-pot-size .main-value') as HTMLElement)?.innerText;
        const pot = parseValue(potText);
        return {
          players,
          communityCards: communityCards.filter(c => c.length === 2),
          pot
        };
      });
      return gameState;
    } catch (error) {
      console.error('Error capturing table state:', error);
      return null;
    }
  }
}
