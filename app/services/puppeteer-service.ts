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
  // Updated init per request: launch if needed, load session, go to PokerNow, check login with manual prompt fallback
  async init(): Promise<boolean> {
    try {
      if (!this.browser) {
        await this.launch();
      }
      if (!this.page) {
        this.page = await this.browser!.newPage();
        this.page.on('console', msg => {
          console.log(`[BROWSER LOG] ${msg.type()}: ${msg.text()}`);
        });
      }
      // Load session (cookies/localStorage/sessionStorage) if available
      await this.loadSession();
      // Navigate to PokerNow homepage if not already there
      const targetUrl = 'https://www.pokernow.club/';
      const currentUrl = this.page.url();
      if (!currentUrl.startsWith(targetUrl)) {
        await this.page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
      }
      // After loading, verify login state
      let loggedIn = await this.isLoggedIn();
      if (!loggedIn) {
        // Prompt user to manually log in, then wait for Enter
        console.log('Please log in to PokerNow in the opened browser window, then press Enter here.');
        await new Promise<void>((resolve) => {
          const onData = () => {
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            resolve();
          };
          try {
            // Ensure stdin is in flowing mode
            if (process.stdin.isPaused()) process.stdin.resume();
          } catch {}
          process.stdin.once('data', onData);
        });
        // Save new session after manual login
        await this.saveSession();
        // Re-check login after user attempt
        loggedIn = await this.isLoggedIn();
      }
      if (!loggedIn) {
        console.log('[PuppeteerService] Login still not detected after manual attempt.');
        return false; // only return false if impossible after attempt
      }
      return true;
    } catch (err) {
      console.error('Error during init:', err);
      return false;
    }
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
  // New: check if logged in on PokerNow by presence of logout/sign-out element
  async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    try {
      // Check common selectors for sign-out/logout presence
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
  async getTableState(): Promise<any> {
    const pokerFrame = this.pickPokerFrame();
    // Get hero name from Node environment or config
    const heroName = process.env.HERO_NAME || '';
    // Node-side logging: input hero name before evaluate
    console.log('[getTableState] Input heroName:', heroName);
    try {
      const result = await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate((heroNameArg: string) => {
        const parseValue = (text: string | null | undefined): number => {
          if (!text) return 0;
          const num = parseFloat((text || '').replace(/[^0-9.]/g, ''));
          return isNaN(num) ? 0 : num;
        };
        // Dealer seat detection via dealer button
        const dealerButtonElement = document.querySelector('.dealer-button-ctn .button');
        let dealerSeat = -1;
        if (dealerButtonElement) {
          const dealerClass = Array.from((dealerButtonElement as HTMLElement).classList).find((c) => c.startsWith('dealer-position-'));
          if (dealerClass) {
            const parts = dealerClass.split('-');
            const maybeSeat = parts[2];
            const parsed = parseInt(maybeSeat || '', 10);
            if (!Number.isNaN(parsed)) dealerSeat = parsed;
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
          status: string;
        };
        const players = Array.from(document.querySelectorAll('.table-player'))
          .map((el) => {
            const seat = parseInt(el.getAttribute('data-seat') || '0', 10);
            const name = (el.querySelector('.table-player-name a')?.innerText?.trim()) || (el.querySelector('.table-player-name')?.innerText?.trim()) || '';
            if (name) {
              try { console.log('Player found:', name); } catch {}
            }
            if (!name) return null;
            const isSelf = el.classList.contains('you-player');
            const isCurrentTurn = !!el.querySelector('.decision-current');
            const isFolded = el.classList.contains('folded');
            const isAllIn = el.classList.contains('all-in');
            // Handle stack with All In check
            let stack = 0;
            const stackEl = el.querySelector('.table-player-stack');
            if (stackEl) {
              const allInText = (stackEl as HTMLElement).innerText?.trim();
              if (allInText?.toLowerCase().includes('all in')) {
                stack = 0; // All in means 0 stack remaining
              } else {
                const chipsValue = stackEl.querySelector('.chips-value') as HTMLElement;
                stack = parseValue(chipsValue?.innerText);
              }
            }
            const betEl = el.querySelector('.table-player-bet-value .chips-value') as HTMLElement;
            const bet = parseValue(betEl?.innerText);
            // Player status
            const statusEl = el.querySelector('.table-player-status-icon') as HTMLElement;
            const status = statusEl?.innerText?.trim() || '';
            // Hole cards for hero only
            const holeCards: string[] = [];
            if (isSelf) {
              const cardElements = el.querySelectorAll('.card-container .card');
              cardElements.forEach((cardEl) => {
                const valueEl = cardEl.querySelector('.value') as HTMLElement;
                const suitEl = cardEl.querySelector('.suit') as HTMLElement;
                if (valueEl && suitEl) {
                  const value = valueEl.innerText?.trim() || '';
                  const suit = suitEl.innerText?.trim() || '';
                  if (value && suit) {
                    holeCards.push(`${value}${suit}`);
                  }
                }
              });
            }
            return {
              seat,
              name,
              stack,
              bet,
              isSelf,
              isDealer: seat === dealerSeat,
              isCurrentTurn,
              isFolded,
              isAllIn,
              holeCards,
              status,
            } as P | null;
          })
          .filter((p): p is P => p !== null);
        // Board cards (community cards)
        const communityCards: string[] = [];
        const boardCardElements = document.querySelectorAll('.table-cards .card-container .card');
        boardCardElements.forEach((cardEl) => {
          const valueEl = cardEl.querySelector('.value') as HTMLElement;
          const suitEl = cardEl.querySelector('.suit') as HTMLElement;
          if (valueEl && suitEl) {
            const value = valueEl.innerText?.trim() || '';
            const suit = suitEl.innerText?.trim() || '';
            if (value && suit) {
              communityCards.push(`${value}${suit}`);
            }
          }
        });
        // Pot detection
        let pot = 0;
        const potEl = document.querySelector('.main-value .normal-value') as HTMLElement;
        if (potEl) {
          pot = parseValue(potEl.textContent);
        }
        // Blinds
        const blinds: number[] = [];
        const blindElements = document.querySelectorAll('.blind-value-ctn .normal-value');
        blindElements.forEach((blindEl) => {
          const blindValue = parseValue((blindEl as HTMLElement).textContent);
          if (blindValue > 0) {
            blinds.push(blindValue);
          }
        });
        // Action buttons
        const actionButtons: string[] = [];
        const buttonElements = document.querySelectorAll('button.action-button');
        buttonElements.forEach((btnEl) => {
          const buttonText = (btnEl as HTMLElement).textContent?.trim() || '';
          if (buttonText) {
            actionButtons.push(buttonText);
          }
        });
        // Use the hero name passed as argument
        const heroNameNormalized = (heroNameArg || '').trim().toLowerCase();
        try { console.log('Hero name being searched for:', heroNameArg); } catch {}
        // If hero name provided, align isSelf based on heroNameArg (in case .you-player missing)
        if (heroNameNormalized) {
          for (const p of players) {
            if ((p.name || '').trim().toLowerCase() === heroNameNormalized) {
              (p as any).isSelf = true;
            }
          }
        }
        // Action turn: check for suspended signal or decision-current on you-player
        let actionTurn = false;
        const suspendedSignal = document.querySelector('.action-signal.suspended');
        const heroDecisionCurrent = document.querySelector('.you-player .decision-current');
        actionTurn = !!(suspendedSignal || heroDecisionCurrent);
        // Expose actionTurn and heroCards by augmenting return if consumer widens type later
        const hero = players.find((p) => p.isSelf) || null;
        const heroCards = hero ? hero.holeCards : [];
        return {
          players,
          communityCards,
          pot,
          actionTurn,
          heroCards,
          blinds,
          actionButtons,
        } as any;
      }, heroName);
      // Node-side logging: evaluate returned successfully
      console.log('[getTableState] Evaluate returned summary:', {
        playersCount: result?.players?.length,
        heroCards: result?.heroCards,
