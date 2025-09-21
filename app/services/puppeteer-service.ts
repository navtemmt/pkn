async getTableState(): Promise<GameState | null> {
  const pokerFrame = this.pickPokerFrame();
  try {
    return await (pokerFrame as puppeteer.Frame | puppeteer.Page).evaluate(() => {
      const parseValue = (text: string | null | undefined): number => {
        if (!text) return 0;
        const num = parseFloat((text || '').replace(/[^0-9.]/g, ''));
        return isNaN(num) ? 0 : num;
      };

      // Dealer seat detection via dealer button class naming
      const dealerButtonElement = document.querySelector('[class*="dealer-button-ctn"]');
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
      };

      const players = Array.from(document.querySelectorAll('.table-player'))
        .map((el) => {
          const seat = parseInt(el.getAttribute('data-seat') || '0', 10);
          const name = (el.querySelector('.table-player-name') as HTMLElement)?.innerText?.trim() || '';
          if (!name) return null;
          const isSelf = el.classList.contains('you-player');
          const isCurrentTurn = !!el.querySelector('.current-player-indicator');
          const isFolded = el.classList.contains('folded');
          const isAllIn = el.classList.contains('all-in');
          const stack = parseValue((el.querySelector('.table-player-stack') as HTMLElement)?.innerText);
          const bet = parseValue((el.querySelector('.table-player-bet-value') as HTMLElement)?.innerText);
          const holeCards = Array.from(el.querySelectorAll('.table-player-cards .card'))
            .map((cardEl) => {
              const v = (cardEl.querySelector('.value') as HTMLElement)?.innerText || '';
              const s = (cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText || '';
              const token = `${v}${s}`.trim();
              return token.length ? token : null;
            })
            .filter(Boolean) as string[];
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
          } as P | null;
        })
        .filter((p): p is P => p !== null);

      // Community cards (flop/turn/river)
      const communityCards = Array.from(document.querySelectorAll('.table-community-cards .card'))
        .map((cardEl) => {
          const v = (cardEl.querySelector('.value') as HTMLElement)?.innerText || '';
          const s = (cardEl.querySelector('.sub-suit') as HTMLElement)?.innerText || '';
          const token = `${v}${s}`.trim();
          return token.length ? token : null;
        })
        .filter(Boolean) as string[];

      // Pot detection: prefer total, fallback to main
      let pot = 0;
      const totalPotEl = document.querySelector('.table-pot-size .total-value');
      if (totalPotEl) {
        pot = parseValue(totalPotEl.textContent);
      } else {
        const mainPotEl = document.querySelector('.table-pot-size .main-value .normal-value');
        if (mainPotEl) pot = parseValue(mainPotEl.textContent);
      }

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

      // Action turn: if hero row has current-player-indicator or global action buttons for you-player
      let actionTurn = false;
      const heroRow = heroName
        ? Array.from(document.querySelectorAll('.table-player')).find((el) => {
            const n = (el.querySelector('.table-player-name') as HTMLElement)?.innerText?.trim().toLowerCase() || '';
            return n === heroName;
          })
        : document.querySelector('.table-player.you-player');
      if (heroRow && heroRow.querySelector('.current-player-indicator')) actionTurn = true;
      if (!actionTurn && document.querySelector('.you-player .action-buttons, .you-player .action-button')) actionTurn = true;

      // Expose actionTurn and heroCards by augmenting return if consumer widens type later
      const hero = players.find((p) => p.isSelf) || null;
      const heroCards = hero ? hero.holeCards : [];

      return { players, communityCards, pot, actionTurn, heroCards } as any;
    });
  } catch (error) {
    console.error('Error capturing table state:', error);
    return null;
  }
}
