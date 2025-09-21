import puppeteer from 'puppeteer';
import { sleep, waitForEnter } from '../helpers/bot-helper.ts';
import type { Response } from '../utils/error-handling-utils.ts';
import fs from 'fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

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
      // Sanitize: if a ws:// URL was placed in BROWSER_URL, treat it as WS endpoint.
      if (browserURL.startsWith('ws://') || browserURL.startsWith('wss://')) {
        this.browser = await puppeteer.connect({ browserWSEndpoint: browserURL });
        console.log('INFO: Connected via WebSocket endpoint (from BROWSER_URL).');
      } else if (wsEndpoint && (wsEndpoint.startsWith('ws://') || wsEndpoint.startsWith('wss://'))) {
        this.browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
        console.log('INFO: Connected to browser via WebSocket endpoint.');
      } else if (browserURL && (browserURL.startsWith('http://') || browserURL.startsWith('https://'))) {
        // Correct browserURL format is http://host:port; Puppeteer discovers the WS endpoint.
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

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    // Seed __name before any page scripts (prevents evaluate crashes if helpers were injected).
    await this.page.evaluateOnNewDocument(() => {
      // @ts-ignore
      (window as any).__name = (fn: any, _n: string) => fn;
    });

    // If reusing an already-loaded page, inject into current doc and frames now.
    if (this.page.url() !== 'about:blank') {
      try {
        await this.page.evaluate(() => {
          // @ts-ignore
          (window as any).__name = (fn: any, _n: string) => fn;
        });
        const frames = this.page.frames();
        await Promise.all(
          frames.map((f) =>
            f.evaluate(() => {
              // @ts-ignore
              (window as any).__name = (fn: any, _n: string) => fn;
            })
          )
        );
      } catch (err) {
        console.warn('WARN: Failed to inject __name into existing document/frames.', err);
      }
    }

    // Raise default timeouts to avoid premature timeouts on first loads.
    this.page.setDefaultTimeout(60000);
    this.page.setDefaultNavigationTimeout(60000);

    this.page.on('pageerror', (err) => console.error('pageerror:', err));
    this.page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warn') {
        console.log(`[console:${t}] ${msg.text()}`);
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

    // Cookies must match the site’s origin (domain or url) to apply.
    try {
      const cookies = JSON.parse(await fs.readFile(cookiesPath, 'utf8'));
      await this.page.setCookie(...cookies);
    } catch {}

    // Pre-inject storage on the target origin before navigation.
    try {
      const localStorageData = await fs.readFile(localStoragePath, 'utf8');
      const sessionStorageData = await fs.readFile(sessionStoragePath, 'utf8');
      await this.page.evaluateOnNewDocument((ls, ss) => {
        try {
          const lsObj = JSON.parse(ls || '{}') as Record<string, string>;
          for (const [k, v] of Object.entries(lsObj)) localStorage.setItem(k, v);
          const ssObj = JSON.parse(ss || '{}') as Record<string, string>;
          for (const [k, v] of Object.entries(ssObj)) sessionStorage.setItem(k, v);
        } catch {}
      }, localStorageData, sessionStorageData);
    } catch {}
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
      // Always move to a neutral page first.
      await this.page.goto('about:blank', { waitUntil: 'load', timeout: 60000 });

      // Prepare session (cookies and storages) before hitting the site.
      await this.loadSession();

      // Navigate to PokerNow and allow a short settle delay.
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'load', timeout: 60000 });
      await delay(1500); // replace deprecated page.waitForTimeout

      console.log('INFO: Navigated to PokerNow with pre-loaded session.');
      if (await this.isLoggedIn()) {
        console.log('SUCCESS: Login confirmed. Session is valid.');
      } else {
        throw new Error('Stale session');
      }
    } catch (error) {
      console.log('WARNING: No valid session found. Falling back to manual login.');
      await this.page.goto('https://www.pokernow.club/', { waitUntil: 'load', timeout: 60000 });
      await delay(1500); // replace deprecated page.waitForTimeout
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
      await this.page.goto(`https://www.pokernow.club/games/${game_id}`, { waitUntil: 'load', timeout: 60000 });
      await this.page.setViewport({ width: 1280, height: 800 });
      return { code: 'success', data: null, msg: `Opened PokerNow game ${game_id}` };
    } catch (e) {
      return { code: 'error', error: new Error(`Failed to open game: ${(e as Error).message}`) };
    }
  }

  private pickPokerFrame(): puppeteer.Page | puppeteer.Frame {
    return this.page.frames().find((fr) => fr.url().includes('pokernow.club')) || this.page;
  }
  
  // ADD: seat-state detection covering full tables and MTT UIs.
  type SeatStatus = {
    seated: boolean;
    tableFull: boolean;
    joinable: boolean;
    waiting: boolean;
    occupied: number;
    capacity: number;
  };
  
  async getSeatStatus(): Promise<SeatStatus> {
    const fr = this.pickPokerFrame();
    return await (fr as puppeteer.Frame | puppeteer.Page).evaluate(() => {
      // Identify seat boxes by data-seat; adjust if PokerNow changes attributes.
      const seatNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-seat]'));
      const capacity = seatNodes.length;
  
      // Occupied seats: rows with a non-empty name.
      const occupied = seatNodes.filter((el) => {
        const name = (el.querySelector('.table-player-name') as HTMLElement)?.innerText?.trim() || '';
        return name.length > 0;
      }).length;
  
      // Hero detection: explicit flag or presence of action buttons (common indicator of “my turn”).
      const heroSeat = document.querySelector('.table-player.you-player') != null;
      const actionPanel = document.querySelector('.action-buttons, .action-button, .buttons, .raise-button') != null;
  
      // Joinable: generic “SIT” / “JOIN” controls anywhere visible in the frame.
      const joinable = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], [class]'))
        .some((e) => /(join|sit)/i.test((e.textContent || '').trim()));
  
      // Waiting: presence of a visible “WAITING” badge/panel.
      const waiting = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .some((e) => /\bwaiting\b/i.test((e.textContent || '').trim()));
  
      const seated = heroSeat || actionPanel;
      const tableFull = !seated && !joinable && occupied >= capacity && capacity > 0;
  
      return { seated, tableFull, joinable, waiting, occupied, capacity };
    });
  }
  
  // ADD: short non-blocking wait for seat opening via generic SIT/JOIN controls.
  async waitForSeatOpen(timeoutMs = 5000): Promise<boolean> {
    const fr = this.pickPokerFrame();
    try {
      await (fr as puppeteer.Frame | puppeteer.Page).waitForFunction(() => {
        return Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], [class]'))
          .some((e) => /(join|sit)/i.test((e.textContent || '').trim()));
      }, { timeout: timeoutMs, polling: 'mutation' });
      return true;
    } catch {
      return false;
    }
  }
  
  // ADD: concise hero-turn detection with a short fallback wait.
  async isHeroTurn(timeoutMs = 500): Promise<boolean> {
    const fr = this.pickPokerFrame();
    const hasAction = await (fr as puppeteer.Frame | puppeteer.Page).$(''.concat(
      '.action-buttons, .action-button, .buttons, .raise-button'
    ));
    if (hasAction) return true;
    const hasIndicator = await (fr as puppeteer.Frame | puppeteer.Page).$('.current-player-indicator');
    if (hasIndicator) return true;
    // brief wait to catch transient render
    try {
      await (fr as puppeteer.Frame | puppeteer.Page).waitForSelector(
        '.action-buttons, .action-button, .buttons, .raise-button',
        { timeout: timeoutMs }
      );
      return true;
    } catch {
      return false;
    }
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
          const dealerClass = Array.from(dealerButtonElement.classList).find((c) => c.startsWith('dealer-position-'));
          if (dealerClass) {
            dealerSeat = parseInt(dealerClass.split('-')[2], 10);
          }
        }

        type P = {
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
        };

        const players = Array.from(document.querySelectorAll('.table-player'))
          .map((el) => {
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
              holeCards: Array.from(el.querySelectorAll('.table-player-cards .card'))
                .map((cardEl) => `${(cardEl.querySelector('.value') as HTMLElement)?.innerText}${(cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText}`)
                .filter(Boolean) as string[],
            } as P | null;
          })
          .filter((p): p is P => p !== null);

        const communityCards = Array.from(document.querySelectorAll('.table-community-cards .card'))
          .map((cardEl) => `${(cardEl.querySelector('.value') as HTMLElement)?.innerText}${(cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText}`)
          .filter(Boolean) as string[];

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
