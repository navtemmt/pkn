import puppeteer from 'puppeteer';
import { sleep, waitForEnter } from '../helpers/bot-helper.ts';
import type { Response } from '../utils/error-handling-utils.ts';
import fs from 'fs/promises';

const cookiesPath = './cookies.json';
const localStoragePath = './localStorage.json';
const sessionStoragePath = './sessionStorage.json';

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

  constructor(default_timeout: number, headless_flag: boolean) {
    this.default_timeout = default_timeout;
    this.headless_flag = headless_flag;
  }

  async init(): Promise<void> {
    const wsEndpoint = (process.env.BROWSER_WS_ENDPOINT || '').trim();
    const browserURL = (process.env.BROWSER_URL || '').trim();
  
    try {
      if (wsEndpoint && (wsEndpoint.startsWith('ws://') || wsEndpoint.startsWith('wss://'))) {
        // Connect using an exact DevTools WebSocket endpoint
        this.browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
        console.log('INFO: Connected to browser via WebSocket endpoint.');
      } else if (browserURL && (browserURL.startsWith('http://') || browserURL.startsWith('https://'))) {
        // Connect using the DevTools HTTP URL; Puppeteer discovers WS endpoint
        this.browser = await puppeteer.connect({ browserURL });
        console.log('INFO: Connected to browser via DevTools HTTP URL.');
      } else {
        console.log('INFO: No browser connection info found, launching new instance.');
        this.browser = await puppeteer.launch({
          defaultViewport: null,
          headless: this.headless_flag,
        });
      }
    } catch (e) {
      console.warn('WARN: Failed to connect to existing browser, launching a new one.', e);
      this.browser = await puppeteer.launch({
        defaultViewport: null,
        headless: this.headless_flag,
      });
    }
  
    // Prefer a fresh page; fall back to first page if present
    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
  
    // Seed the page context before any site scripts run to avoid evaluate crashes.
    await this.page.evaluateOnNewDocument(() => {
      // @ts-ignore
      // Neutralize name-preserving helper calls injected by some toolchains.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (window as any).__name = (fn: any, _n: string) => fn;
    });
  
    // Optional: set default timeouts
    this.page.setDefaultTimeout(this.default_timeout);
    this.page.setDefaultNavigationTimeout(this.default_timeout);
  
    // Existing listeners
    this.page.on('pageerror', (err) => console.error('pageerror:', err));
    this.page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warn') {
        console.log(`[console:${t}] ${msg.text()}`);
      }
    });
  }


    await this.page.setRequestInterception(true);
    this.page.on('request', (request) => {
      if (request.url().includes('google-analytics')) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await this.manageLoginAndCookies();
  }

  private async saveSession(): Promise<void> {
    try {
      const cookies = await this.page.cookies();
      await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
      const localStorageData = await this.page.evaluate(() => JSON.stringify(window.localStorage));
      await fs.writeFile(localStoragePath, localStorageData);
      const sessionStorageData = await this.page.evaluate(() => JSON.stringify(window.sessionStorage));
      await fs.writeFile(sessionStoragePath, sessionStorageData);
      console.log('SUCCESS: Full session has been saved.');
    } catch (error) {
      console.error('ERROR: Failed to save session:', error);
    }
  }

  private async loadSession(): Promise<void> {
    console.log('INFO: Attempting to load saved session...');
    const cookies = JSON.parse(await fs.readFile(cookiesPath, 'utf8'));
    await this.page.setCookie(...cookies);
    const localStorageData = await fs.readFile(localStoragePath, 'utf8');
    await this.page.evaluate(data => {
      for (const [key, value] of Object.entries(JSON.parse(data))) {
        localStorage.setItem(key, value as string);
      }
    }, localStorageData);
    const sessionStorageData = await fs.readFile(sessionStoragePath, 'utf8');
    await this.page.evaluate(data => {
      for (const [key, value] of Object.entries(JSON.parse(data))) {
        sessionStorage.setItem(key, value as string);
      }
    }, sessionStorageData);
    console.log('SUCCESS: Full session has been loaded.');
  }

  private async isLoggedIn(): Promise<boolean> {
    const pokerFrame = this.pickPokerFrame(); 
    const loginCheckSelector = 'a[href="/sign_out"]';
    for (let i = 0; i < 10; i++) {
      if (await pokerFrame.$(loginCheckSelector)) return true;
      await sleep(500); 
    }
    return false;
  }

  private async manageLoginAndCookies(): Promise<void> {
    try {
      await this.page.goto('about:blank', { waitUntil: 'networkidle2' });
      await this.loadSession();
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'networkidle2' });
      console.log('INFO: Navigated to PokerNow with pre-loaded session.');
      if (await this.isLoggedIn()) {
          console.log('SUCCESS: Login confirmed. Session is valid.');
      } else {
          throw new Error('Stale session');
      }
    } catch (error) {
      console.log('WARNING: No valid session found. Falling back to manual login.');
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'networkidle2' });
      await waitForEnter('ACTION REQUIRED: Please log in to PokerNow, then press Enter...');
      await this.saveSession();
    }
  }
    
  async closeBrowser(): Promise<void> {
    if ((process.env.BROWSER_WS_ENDPOINT || '').trim() || (process.env.BROWSER_URL || '').trim()) {
      this.browser.disconnect();
    } else {
      await this.browser.close();
    }
  }

  async navigateToGame(game_id: string): Promise<Response<null, Error>> {
    if (!game_id || typeof game_id !== 'string') {
      return { code: 'error', error: new Error('Game ID is invalid.') };
    }
    try {
      await this.page.goto(`https://www.pokernow.club/games/${game_id}`, { waitUntil: 'networkidle2' });
      await this.page.setViewport({ width: 1280, height: 800 });
      return { code: 'success', data: null, msg: `Opened PokerNow game ${game_id}` };
    } catch (e) {
      return { code: 'error', error: new Error(`Failed to open game: ${(e as Error).message}`) };
    }
  }

  private pickPokerFrame(): puppeteer.Page | puppeteer.Frame {
    return this.page.frames().find(fr => fr.url().includes('pokernow.club')) || this.page;
  }

  async getTableState(): Promise<GameState | null> {
    const pokerFrame = this.pickPokerFrame();
    try {
      return await pokerFrame.evaluate(() => {
        const parseValue = (text: string | null | undefined): number => {
          if (!text) return 0;
          const num = parseFloat(text.replace(/[^0-9.]/g, ''));
          return isNaN(num) ? 0 : num;
        };

        const dealerButtonElement = document.querySelector('[class*="dealer-button-ctn"]');
        let dealerSeat = -1;
        if (dealerButtonElement) {
          const dealerClass = Array.from(dealerButtonElement.classList).find(c => c.startsWith('dealer-position-'));
          if (dealerClass) {
            dealerSeat = parseInt(dealerClass.split('-')[2], 10);
          }
        }

        const players: Player[] = Array.from(document.querySelectorAll('.table-player')).map(el => {
          const seat = parseInt(el.getAttribute('data-seat') || '0', 10);
          const name = (el.querySelector('.table-player-name') as HTMLElement)?.innerText || '';
          if (!name) return null;

          return {
            seat,
            name,
            stack: parseValue((el.querySelector('.table-player-stack') as HTMLElement)?.innerText),
            bet: parseValue((el.querySelector('.table-player-bet-value') as HTMLElement)?.innerText),
            isSelf: el.classList.contains('you-player'),
            isDealer: seat === dealerSeat,
            isCurrentTurn: !!el.querySelector('.current-player-indicator'),
            isFolded: el.classList.contains('folded'),
            isAllIn: el.classList.contains('all-in'),
            holeCards: Array.from(el.querySelectorAll('.table-player-cards .card')).map(cardEl => 
                `${(cardEl.querySelector('.value') as HTMLElement)?.innerText}${(cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText}`
            ).filter(Boolean)
          };
        }).filter((p): p is Player => p !== null);

        const communityCards = Array.from(document.querySelectorAll('.table-community-cards .card')).map(cardEl => 
            `${(cardEl.querySelector('.value') as HTMLElement)?.innerText}${(cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText}`
        ).filter(Boolean);

        let pot = 0;
        const totalPotEl = document.querySelector('.table-pot-size .total-value');
        if (totalPotEl) {
            pot = parseValue(totalPotEl.textContent);
        } else {
            const mainPotEl = document.querySelector('.table-pot-size .main-value .normal-value');
            if (mainPotEl) pot = parseValue(mainPotEl.textContent);
        }

        return { players, communityCards, pot };
      });
    } catch (error) {
      console.error('Error capturing table state:', error);
      return null;
    }
  }
}
