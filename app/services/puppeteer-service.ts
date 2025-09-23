import * as puppeteer from 'puppeteer';
import { promises as fs } from 'fs';

interface GameState {
  players: Array<{
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
    status: string;
  }>;
  communityCards: string[];
  pot: number;
  actionTurn: boolean;
  heroCards: string[];
  blinds: number[];
  actionButtons: string[];
}

export class PuppeteerService {
  private browser: puppeteer.Browser | null = null;
  private page: puppeteer.Page | null = null;

  async init(): Promise<void> {
    if (!this.browser) {
      await this.launch();
    }
    // Ensure a page exists
    if (!this.page && this.browser) {
      this.page = await this.browser.newPage();
    }
    // Try to restore session and check login status (non-fatal if unavailable)
    try {
      await this.loadSession();
    } catch {}
    try {
      // Navigate to PokerNow home to allow login detection when possible
      if (this.page) {
        const targetUrl = 'https://www.pokernow.club/';
        const currentUrl = this.page.url();
        if (!currentUrl || !currentUrl.startsWith(targetUrl)) {
          await this.page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
        }
      }
    } catch {}
    // Soft-check login state; do not throw here to preserve manual login flows
    try {
      const ok = await this.isLoggedIn();
      if (!ok) {
        console.log('[PuppeteerService] Not logged in; proceed with manual login if needed.');
      }
    } catch {}
  }

  async launch(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
    });
    this.page = await this.browser.newPage();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async loadSession(): Promise<void> {
    if (!this.page) {
      console.error('Browser page not initialized');
      return;
    }
    try {
      // Load cookies
      try {
        const cookiesData = await fs.readFile('cookies.json', 'utf8');
        const cookies = JSON.parse(cookiesData);
        if (Array.isArray(cookies) && cookies.length > 0) {
          await this.page.setCookie(...cookies);
          console.log('Cookies loaded successfully');
        }
      } catch (error) {
        console.error('Error loading cookies:', error);
      }
      // Load localStorage
      try {
        const localStorageData = await fs.readFile('localStorage.json', 'utf8');
        const localStorage = JSON.parse(localStorageData);
        if (localStorage && typeof localStorage === 'object') {
          await this.page.evaluateOnNewDocument((data) => {
            for (const [key, value] of Object.entries(data)) {
              window.localStorage.setItem(key, value as string);
            }
          }, localStorage);
          console.log('LocalStorage loaded successfully');
        }
      } catch (error) {
        console.error('Error loading localStorage:', error);
      }
      // Load sessionStorage
      try {
        const sessionStorageData = await fs.readFile('sessionStorage.json', 'utf8');
        const sessionStorage = JSON.parse(sessionStorageData);
        if (sessionStorage && typeof sessionStorage === 'object') {
          await this.page.evaluateOnNewDocument((data) => {
            for (const [key, value] of Object.entries(data)) {
              window.sessionStorage.setItem(key, value as string);
            }
          }, sessionStorage);
          console.log('SessionStorage loaded successfully');
        }
      } catch (error) {
        console.error('Error loading sessionStorage:', error);
      }
    } catch (error) {
      console.error('Error loading session:', error);
    }
  }

  async saveSession(): Promise<void> {
    if (!this.page) {
      console.error('Browser page not initialized');
      return;
    }
    try {
      // Save cookies
      try {
        const cookies = await this.page.cookies();
        await fs.writeFile('cookies.json', JSON.stringify(cookies, null, 2));
        console.log('Cookies saved successfully');
      } catch (error) {
        console.error('Error saving cookies:', error);
      }
      // Save localStorage
      try {
        const localStorage = await this.page.evaluate(() => {
          const data: { [key: string]: string } = {};
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key) {
              data[key] = window.localStorage.getItem(key) || '';
            }
          }
          return data;
        });
        await fs.writeFile('localStorage.json', JSON.stringify(localStorage, null, 2));
        console.log('LocalStorage saved successfully');
      } catch (error) {
        console.error('Error saving localStorage:', error);
      }
      // Save sessionStorage
      try {
        const sessionStorage = await this.page.evaluate(() => {
          const data: { [key: string]: string } = {};
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            if (key) {
              data[key] = window.sessionStorage.getItem(key) || '';
            }
          }
          return data;
        });
        await fs.writeFile('sessionStorage.json', JSON.stringify(sessionStorage, null, 2));
        console.log('SessionStorage saved successfully');
      } catch (error) {
        console.error('Error saving sessionStorage:', error);
      }
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  async navigateToGame(gameId: string): Promise<boolean> {
    if (!gameId) {
      console.error('No gameId provided to navigateToGame');
      return false;
    }
    try {
      if (!this.page) {
        throw new Error('Browser page not initialized');
      }
      await this.page.goto(`https://www.pokernow.club/games/${gameId}`, {
        waitUntil: 'load',
        timeout: 60000,
      });
      await this.page.setViewport({ width: 1280, height: 800 });
      return true;
    } catch (err) {
      console.error('Failed to open game:', err);
      return false;
    }
  }

  private pickPokerFrame(): puppeteer.Frame | puppeteer.Page {
    // Implementation to pick the appropriate frame or page
    return this.page as puppeteer.Page;
  }

  // Added: login state detection helper
  async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const hasSignOut = await this.page.evaluate(() => {
        const selectors = [
          '.logout-form',
          'a[href="/sign_out"]',
          'form[action*="sign_out"]',
          'a[href*="logout"]',
          'button[name="logout"], button[id*="logout" i], button[class*="logout" i]',
        ];
        return selectors.some((sel) => !!document.querySelector(sel));
      });
      return !!hasSignOut;
    } catch (e) {
      console.error('Error checking login status:', e);
      return false;
    }
  }

  async getTableState(): Promise<GameState | null> {
    const pokerFrame = this.pickPokerFrame();
    // Get hero name from Node environment or config
    const heroName = process.env.HERO_NAME || '';

    try {
      const result = await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate((heroNameArg: string) => {
        try {
          console.log('[HERO-NAME-ARG]', heroNameArg);
          const players = Array.from(document.querySelectorAll('.table-player'))
            .map(el => {
              const name = (el.querySelector('.table-player-name a')?.innerText?.trim()) ||
                          (el.querySelector('.table-player-name')?.innerText?.trim()) || '';
              console.log('[PLAYER-NAME]', name);
              return {
                name,
                isSelf: name === heroNameArg
              };
            });
          console.log('[PLAYERS-ARRAY]', players);
          return { players };
        } catch (err) {
          console.error('[DEBUG-EVAL-START] Error:', err && err.message);
          throw err;
        }
      }, heroName);
      console.log('Node: Extracted players:', (result.players || []).map(p => p.name));
      return result as any;
    } catch (error) {
      console.error('Error capturing table state:', error);
      return null;
    }
  }
}
