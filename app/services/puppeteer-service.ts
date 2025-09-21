import * as puppeteer from 'puppeteer';

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

  private pickPokerFrame(): puppeteer.Frame | puppeteer.Page {
    // Implementation to pick the appropriate frame or page
    return this.page as puppeteer.Page;
  }

  async getTableState(): Promise<GameState | null> {
    const pokerFrame = this.pickPokerFrame();
    try {
      return await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate(() => {
        const parseValue = (text: string | null | undefined): number => {
          if (!text) return 0;
          const num = parseFloat((text || '').replace(/[^0-9.]/g, ''));
          return isNaN(num) ? 0 : num;
        };
        
        // Dealer seat detection via dealer button
        const dealerButtonElement = document.querySelector('.dealer-button-ctn .button');
        let dealerSeat = -1;
        if (dealerButtonElement) {
          const dealerClass = Array.from(dealerButtonElement.classList).find((c) => c.startsWith('dealer-position-'));
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
            const name = (el.querySelector('.table-player-name') as HTMLElement)?.innerText?.trim() || '';
            if (!name) return null;
            
            const isSelf = el.classList.contains('you-player');
            const isCurrentTurn = !!el.querySelector('.decision-current');
            const isFolded = el.classList.contains('folded');
            const isAllIn = el.classList.contains('all-in');
            
            // Handle stack with All In check
            let stack = 0;
            const stackEl = el.querySelector('.table-player-stack');
            if (stackEl) {
              const allInText = stackEl.innerText?.trim();
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
        
        // Determine hero name from environment if injected into page, else fallback to you-player
        const envHero = (window as any).process?.env?.HERO_NAME || (document.querySelector('meta[name="hero-name"]') as HTMLMetaElement)?.content || '';
        let heroName = (envHero || '').trim().toLowerCase();
        if (!heroName) {
          const selfEl = document.querySelector('.table-player.you-player .table-player-name') as HTMLElement | null;
          heroName = (selfEl?.innerText || '').trim().toLowerCase();
        }
        
        // If HERO_NAME provided, align isSelf based on name (in case .you-player missing)
        if (heroName) {
          for (const p of players) {
            if ((p.name || '').trim().toLowerCase() === heroName) {
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
          actionButtons 
        } as any;
      });
    } catch (error) {
      console.error('Error capturing table state:', error);
      return null;
    }
  }
}
