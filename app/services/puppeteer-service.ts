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
  async navigateToGame(gameId: string): Promise<{ code: string }> {
    if (!gameId) {
      console.error('No gameId provided to navigateToGame');
      return { code: 'error' };
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
      return { code: 'success' };
    } catch (err) {
      console.error('Failed to open game:', err);
      return { code: 'error' };
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

  // Helper to reliably extract player names outside evaluate
  private async extractPlayersOutside(): Promise<string[]> {
    const pokerFrame = this.pickPokerFrame();
    try {
      const names = await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate(() => {
        const list = Array.from(document.querySelectorAll('.table-player'))
          .map((el) => {
            const nameElement = (el.querySelector('.table-player-name a') || el.querySelector('.table-player-name')) as HTMLElement | null;
            return (nameElement?.textContent || '').trim();
          })
          .filter(Boolean) as string[];
        return list;
      });
      return names;
    } catch (e) {
      console.error('Error extracting players outside evaluate:', e);
      return [];
    }
  }

  async getTableState(): Promise<GameState | null> {
    const pokerFrame = this.pickPokerFrame();

    // 1) Extract player list outside .evaluate and pick hero name
    let heroName = process.env.HERO_NAME || '';
    try {
      const players = await this.extractPlayersOutside();
      // Prefer an exact match with HERO_NAME if provided; otherwise pick the first non-empty
      if (players && players.length > 0) {
        if (heroName) {
          const exact = players.find((p) => p === heroName);
          heroName = exact || players[0];
        } else {
          heroName = players[0];
        }
      }
    } catch (e) {
      console.error('Failed to extract players outside evaluate:', e);
    }

    try {
      const result = await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate((heroNameArg: string) => {
        try {
          console.log('[HERO-NAME-ARG]', heroNameArg);

          // Check for action signal to detect if it's hero's turn
          const actionSignal = document.querySelector('p.action-signal');
          const isHeroTurn = actionSignal && actionSignal.textContent &&
            actionSignal.textContent.trim().toUpperCase() === 'YOUR TURN';

          console.log('[ACTION-SIGNAL]', actionSignal ? actionSignal.textContent : 'not found');
          console.log('[IS-HERO-TURN]', isHeroTurn);

          // Inline DOM extraction functions
          const extractHoleCards = () => {
            const cards = document.querySelectorAll('.hero-cards .card');
            return Array.from(cards).map(card => card.textContent?.trim() || '');
          };

          const extractCommunityCards = () => {
            const cards = document.querySelectorAll('.community-cards .card');
            return Array.from(cards).map(card => card.textContent?.trim() || '');
          };

          const extractPot = () => {
            const potElement = document.querySelector('.pot-amount');
            const potText = potElement?.textContent?.trim() || '0';
            return parseFloat(potText.replace(/[^\d.-]/g, '')) || 0;
          };

          const extractActionButtons = () => {
            const buttons = document.querySelectorAll('.action-buttons button:not(:disabled)');
            return Array.from(buttons).map(btn => btn.textContent?.trim() || '');
          };

          const players = Array.from(document.querySelectorAll('.table-player'))
            .map((el, index) => {
              const nameElement = el.querySelector('.table-player-name a') ||
                                el.querySelector('.table-player-name');
              const name = nameElement?.textContent?.trim() || '';

              const stackElement = el.querySelector('.table-player-stack');
              const stackText = stackElement?.textContent?.trim() || '0';
              const stack = parseFloat(stackText.replace(/[^\d.-]/g, '')) || 0;

              const betElement = el.querySelector('.table-player-bet');
              const betText = betElement?.textContent?.trim() || '0';
              const bet = parseFloat(betText.replace(/[^\d.-]/g, '')) || 0;

              const isSelf = name === heroNameArg;
              const isDealer = !!el.querySelector('.dealer-button');
              const isFolded = el.classList.contains('folded') ||
                             !!el.querySelector('.folded');
              const isAllIn = el.classList.contains('all-in') ||
                            !!el.querySelector('.all-in');

              // Only set isCurrentTurn for hero if action signal is present
              const isCurrentTurn = isSelf && isHeroTurn;

              console.log(`[PLAYER-${index}]`, {
                name,
                isSelf,
                isCurrentTurn,
                stack,
                bet,
                isDealer,
                isFolded,
                isAllIn
              });

              return {
                seat: index + 1,
                name,
                stack,
                bet,
                isSelf,
                isDealer,
                isCurrentTurn,
                isFolded,
                isAllIn,
                holeCards: isSelf ? extractHoleCards() : [],
                status: isFolded ? 'folded' : (isAllIn ? 'all-in' : 'active')
              };
            });

          const communityCards = extractCommunityCards();
          const pot = extractPot();

          console.log('[EXTRACTED-STATE]', {
            playersCount: players.length,
            heroFound: players.some(p => p.isSelf),
            heroTurn: players.find(p => p.isSelf)?.isCurrentTurn,
            communityCardsCount: communityCards.length,
            pot
          });

          return {
            players,
            communityCards,
            pot,
            actionTurn: isHeroTurn,
            heroCards: players.find(p => p.isSelf)?.holeCards || [],
            blinds: [0.5, 1], // Default blinds, should be extracted from UI
            actionButtons: extractActionButtons()
          };
        } catch (err) {
          console.error('[DEBUG-EVAL-START] Error:', err && (err as any).message);
          throw err;
        }
      }, heroName);

      console.log('Node: Extracted players:', (result.players || []).map(p =>
        `${p.name}${p.isSelf ? ' (HERO)' : ''}${p.isCurrentTurn ? ' (TURN)' : ''}`
      ));

      return result as GameState;
    } catch (error) {
      console.error('Error capturing table state:', error);
      return null;
    }
  }
}
