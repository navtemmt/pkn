import puppeteer from 'puppeteer';
import { computeTimeout, sleep } from '../helpers/bot-helper.ts';
import type { Response } from '../utils/error-handling-utils.ts';

interface GameInfo {
  game_type: string,
  big_blind: number,
  small_blind: number,
}

export class PuppeteerService {
  private default_timeout: number;
  private headless_flag: boolean;
  private browser!: puppeteer.Browser;
  private page!: puppeteer.Page;
  private observe_only: boolean = process.env.ADVISOR_OBSERVE === '1';

  constructor(default_timeout: number, headless_flag: boolean) {
    this.default_timeout = default_timeout;
    this.headless_flag = headless_flag;
  } // constructor closes here [leave this]

  // Keep EVERY method below inside the class, until the final closing brace at file end

  convertGameInfo(raw: string): Response<any, Error> {
    try {
      if (!raw || typeof raw !== 'string') throw new Error('Empty game info text');
      const text = raw.replace(/\s+/g, ' ').trim();
      const rx = /([A-Za-z]{1,3}\s*~\s*)?([£$€]?\s*\d+(?:\.\d+)?)[ ]*\/[ ]*([£$€]?\s*\d+(?:\.\d+)?)(?:[ ]*ante[ ]*([£$€]?\s*\d+(?:\.\d+)?))?/i;
      const m = text.match(rx);
      if (!m) throw new Error('Unrecognized blinds format');
      const num = (s: string) => parseFloat(s.replace(/[^\d.]/g, ''));
      const small_blind = num(m[2]);
      const big_blind = num(m[3]);
      const ante = m[4] ? num(m[4]) : 0;
      const curFrom = (s: string) => { const c = s.match(/[£$€]/); return c ? c[0] : ''; };
      const currency = curFrom(m[2]) || curFrom(m[3]);
      return { code: 'success', data: { small_blind, big_blind, ante, currency } as any, msg: 'Parsed game info.' };
    } catch {
      return { code: 'error', error: new Error('Failed to parse game info.') as Error };
    }
  }



  // Attach to an existing Chrome (BROWSER_WS_ENDPOINT) or launch normally
  async init(): Promise<void> {
    const ws = (process.env.BROWSER_WS_ENDPOINT || '').trim();
    const httpBase = (process.env.BROWSER_URL || '').trim(); // e.g., http://127.0.0.1:9222
  
    // 1) Try to connect using env, preferring ws endpoint, otherwise browserURL
    try {
      if (ws && (ws.startsWith('ws://') || ws.startsWith('wss://'))) {
        this.browser = await puppeteer.connect({ browserWSEndpoint: ws });
      } else if (httpBase && (httpBase.startsWith('http://') || httpBase.startsWith('https://'))) {
        this.browser = await puppeteer.connect({ browserURL: httpBase });
      } else {
        throw new Error('No connect URL provided');
      }
    } catch (e) {
      // 2) If connect failed and we have an HTTP base, refresh ws from /json/version and retry once
      if (httpBase) {
        try {
          const base = httpBase.replace(/\/$/, '');
          const res = await fetch(base + '/json/version');
          const data = await res.json();
          const refreshed = data && data.webSocketDebuggerUrl;
          if (!refreshed) throw new Error('No webSocketDebuggerUrl in /json/version');
          this.browser = await puppeteer.connect({ browserWSEndpoint: refreshed });
        } catch (e2) {
          // 3) Final fallback: launch a fresh browser
          this.browser = await puppeteer.launch({ defaultViewport: null, headless: this.headless_flag });
        }
      } else {
        // No httpBase to refresh from: launch a fresh browser
        this.browser = await puppeteer.launch({ defaultViewport: null, headless: this.headless_flag });
      }
    }
  
    // Select existing PokerNow tab or create one
    const pages = await this.browser.pages();
    const pokerPage = pages.find(p => {
      const u = p.url() || '';
      return u.indexOf('pokernow.club') !== -1;
    });
    this.page = pokerPage ? pokerPage : (await this.browser.newPage());
  
    // Diagnostics
    this.page.on('pageerror', err => console.error('pageerror:', err));
    this.page.on('error', err => console.error('page crash/error:', err));
    this.page.on('console', msg => {
      console.log('[console:' + msg.type() + '] ' + msg.text());
    });
    this.page.on('requestfailed', req => {
      const f = req.failure();
      console.warn('requestfailed:', req.url(), f ? f.errorText : undefined);
    });
  }


  async closeBrowser(): Promise<void> {
    const ws = (process.env.BROWSER_WS_ENDPOINT || '').trim();
    if (ws) {
      // Detach from the external browser; leave the playing Chrome intact
      this.browser.disconnect();
    } else {
      // Close only if this process launched the browser
      await this.browser.close();
    }
  }



  async navigateToGame<D, E=Error>(game_id: string): Response<D,E> {
    if (!game_id) return { code: 'error', error: new Error('Game id cannot be empty.') as E };
    try {
      await this.page.goto(`https://www.pokernow.club/games/${game_id}`, { waitUntil: 'networkidle2' });
      await this.page.setViewport({ width: 1280, height: 800 });
      return { code: 'success', data: null as D, msg: `Opened PokerNow game ${game_id}` };
    } catch (e) {
      return { code: 'error', error: new Error(`Failed to open game: ${(e as Error).message}`) as E };
    }
  }
  
  // helper: choose the frame that contains PokerNow content
  private pickPokerFrame(): puppeteer.Page | puppeteer.Frame {
    const frames = this.page.frames();
    const f = frames.find(fr => (fr.url() || '').includes('pokernow.club'));
    return f || this.page;
  }
  
  // replace waitForGameInfo
  async waitForGameInfo<D, E = Error>(): Response<D, E> {
    const ctx: any = this.pickPokerFrame();
    try {
      const candidates = [
        '.game-infos .blind-value-ctn .blind-value',
        '.game-infos .blind-value',
        '[class*="game"][class*="info"]'
      ];
      let found = false;
      for (const sel of candidates) {
        try {
          await ctx.waitForSelector(sel, { timeout: this.default_timeout * 10, visible: true });
          found = true;
          break;
        } catch {}
      }
      if (!found) {
        await ctx.waitForFunction(() => {
          const rx = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
            if (rx.test(t)) return true;
          }
          return false;
        }, { timeout: this.default_timeout * 15 });
      }
      return { code: 'success', data: null as D, msg: 'Game info is present.' };
    } catch {
      return { code: 'error', error: new Error('Failed to wait for game information.') as E };
    }
  }
  
  // replace getGameInfo
  async getGameInfo<D, E = Error>(): Response<D, E> {
    const ctx: any = this.pickPokerFrame();
    try {
      const selectors = [
        '.game-infos .blind-value-ctn .blind-value',
        '.game-infos .blind-value',
        '.game-infos'
      ];
      let text = '';
      for (const sel of selectors) {
        const handle = await ctx.$(sel);
        if (handle) {
          text = (await ctx.$eval(sel, (el: Element) => (el.textContent || '').trim())).trim();
          if (text) break;
        }
      }
      if (!text) {
        text = await ctx.evaluate(() => {
          const rx = /([A-Z]{1,3}\s*~\s*)?([£$€]?\s*\d+(?:\.\d+)?)[^\S\r\n]*\/[^\S\r\n]*([£$€]?\s*\d+(?:\.\d+)?)/i;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
            if (rx.test(t)) return t;
          }
          return '';
        });
      }
      if (!text) throw new Error('No blinds text found');
      return { code: 'success', data: text as D, msg: 'Successfully grabbed the game info.' };
    } catch {
      return { code: 'error', error: new Error('Could not get game info.') as E };
    }
  }



  // Advisor-only flow: skip joining if already seated or in observe-only mode
  async sendEnterTableRequest<D, E = Error>(name: string, stack_size: number): Response<D, E> {
    // If already seated, skip
    if (await this.page.$('.you-player')) {
      return { code: "success", data: null as D, msg: "Already seated; skipping join." };
    }
    // In observe-only mode, never attempt to seat
    if (this.observe_only) {
      return { code: "success", data: null as D, msg: "Observation mode enabled; skipping join." };
    }

    if (name.length < 2 || name.length > 14) {
      return { code: "error", error: new Error("Player name must be betwen 2 and 14 characters long.") as E }
    }

    try {
      // 1) Click a visible, enabled open seat
      await this.page.waitForSelector(".table-player-seat-button", { timeout: this.default_timeout * 4, visible: true });
      const seatButtons = await this.page.$$(".table-player-seat-button");
      let clicked = false;
      for (const btn of seatButtons) {
        const box = await btn.boundingBox();
        const disabled = await this.page.evaluate(el => (el as HTMLButtonElement).disabled ?? false, btn);
        if (box && !disabled) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error("No clickable seat found");

      await this.page.waitForTimeout(500);

      // 2) Wait broadly for a join form or inputs
      let form =
        await this.page.$(".selected form") ||
        await this.page.$('form:has(button[type="submit"])') ||
        await this.page.$("form");

      if (!form) {
        await this.page.waitForSelector('input[placeholder], input[name], input[type="text"], input[type="number"]', {
          visible: true,
          timeout: Math.max(15000, this.default_timeout * 10)
        });
      }

      // Determine context for queries (page vs frame, if extended later)
      const ctx: puppeteer.Page | puppeteer.Frame = this.page;

      // 3) Name input (robust selectors)
      const nameInput =
        (await ctx.$('aria/Name[role="textbox"]')) ||
        (await ctx.$('::-p-aria(Name)[role="textbox"]')) ||
        (await form?.$('input[placeholder*="name" i]')) ||
        (await form?.$('input[name="name"]')) ||
        (await form?.$('input[type="text"]')) ||
        (await ctx.waitForSelector('input[placeholder], input[name], input[type="text"]', { visible: true, timeout: this.default_timeout }));
      if (!nameInput) throw new Error("Name input not found");
      await nameInput.click();
      await this.page.keyboard.type(name);

      // 4) Stack input (robust selectors)
      const stackInput =
        (await ctx.$('aria/Stack[role="spinbutton"]')) ||
        (await form?.$('input[placeholder*="stack" i]')) ||
        (await form?.$('input[name="stack"]')) ||
        (await form?.$('input[type="number"]')) ||
        (await ctx.waitForSelector('input[type="number"], input[name], input[placeholder]', { visible: true, timeout: this.default_timeout }));
      if (!stackInput) throw new Error("Stack input not found");
      await stackInput.click();
      await this.page.keyboard.type(String(stack_size));

      // 5) Submit the join form
      const joinBtn =
        (await ctx.$('button[type="submit"]')) ||
        (await ctx.$('aria/Join[role="button"]')) ||
        (await ctx.$('::-p-aria(Join)[role="button"]')) ||
        (await form?.$('button'));
      if (!joinBtn) throw new Error("Join/submit button not found");
      await (joinBtn as puppeteer.ElementHandle<Element>).click();

    } catch (err) {
      return {
        code: "error",
        error: new Error((err as Error).message || "Could not enter a seat/join form") as E
      }
    }

    // 6) Confirmation or validation
    try {
      await this.page.waitForSelector(".alert-1-buttons > button", { timeout: this.default_timeout });
      await this.page.$eval(".alert-1-buttons > button", (button: any) => button.click());
    } catch {
      let message = "Table ingress unsuccessful.";
      if (await this.page.$(".selected form .error-message")) {
        message = "Player name must be unique to game.";
      }
      const cancelBtn = await this.page.$(".selected > button, button:has-text('Cancel')");
      if (cancelBtn) await cancelBtn.click();
      return { code: "error", error: new Error(message) as E }
    }

    return { code: "success", data: null as D, msg: "Table ingress request successfully sent." }
  }

  async waitForTableEntry<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".you-player", { timeout: this.default_timeout * 120 });
    } catch (err) {
      return {
        code: "error",
        error: new Error("Table ingress request not accepted by host.") as E
      }
    }
    return {
      code: "success",
      data: null as D,
      msg: "Successfully entered table."
    }
  }

  async waitForNextHand<D, E = Error>(num_players: number, max_turn_length: number): Response<D, E> {
    try {
      await this.page.waitForSelector([".you-player > .waiting", ".you-player > .waiting-next-hand"].join(','), { timeout: this.default_timeout });
    } catch (err) {
      return {
        code: "error",
        error: new Error("Player is not in waiting state.") as E
      }
    }
    try {
      await this.page.waitForSelector([".you-player > .waiting", ".you-player > .waiting-next-hand"].join(','),
        { hidden: true, timeout: computeTimeout(num_players, max_turn_length, 4) * 5 + this.default_timeout });
    } catch (err) {
      return {
        code: "error",
        error: new Error("Player is not in waiting state.") as E
      }
    }
    return {
      code: "success",
      data: null as D,
      msg: "Waited for next hand to start."
    }
  }

  async getNumPlayers<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".table-player", { timeout: this.default_timeout });
      const table_players_count = await this.page.$$eval(".table-player", (divs: any) => divs.length) as number;
      const table_player_status_count = await this.page.$$eval(".table-player-status-icon", (divs: any) => divs.length) as number;
      const num_players = table_players_count - table_player_status_count;
      return {
        code: "success",
        data: num_players as D,
        msg: `Successfully got number of players in table: ${num_players}`
      }
    } catch (err) {
      return {
        code: "error",
        error: new Error("Failed to compute number of players in table.") as E
      }
    }
  }
  const ctx: any = this.pickPokerFrame();
  const diag = await ctx.$$eval('.game-decisions-ctn .action-buttons button, .game-decisions-ctn .action-buttons [role="button"]', els =>
    els.map(el => {
      const b = el as HTMLButtonElement;
      const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim(),
        disabledProp: (b as any).disabled === true,
        ariaDisabled: aria === 'true',
        hasDisabledClass: el.classList.contains('disabled'),
        size: { w: rect.width, h: rect.height }
      };
    })
  );
  console.log('Decision controls snapshot:', diag);

  // frame-aware version with robust enabled detection
  async waitForBotTurnOrWinner<D, E = Error>(num_players: number, max_turn_length: number): Response<D, E> {
    const timeout = computeTimeout(num_players, max_turn_length, 4) * 5 + this.default_timeout;
    const ctx: any = this.pickPokerFrame(); // Frame or Page
  
    try {
      // Any actionable button: not disabled attribute, not aria-disabled, not CSS .disabled, and visible
      await ctx.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('.game-decisions-ctn .action-buttons button, .game-decisions-ctn .action-buttons [role="button"]')) as HTMLElement[];
        return btns.some(b => {
          const ariaDis = (b.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
          const hasDisabledClass = b.classList.contains('disabled');
          const isDisabledProp = (b as HTMLButtonElement).disabled === true;
          const rect = b.getBoundingClientRect();
          const visible = !!(rect.width && rect.height);
          return visible && !isDisabledProp && !ariaDis && !hasDisabledClass;
        });
      }, { timeout });
      return { code: 'success', data: 'action' as D, msg: 'Detected actionable decision control.' };
    } catch {}
  
    try {
      await ctx.waitForSelector('.table-player.winner', { timeout });
      return { code: 'success', data: 'table-player winner' as D, msg: 'Detected winner element.' };
    } catch (err) {
      return { code: 'error', error: new Error('No action or winner detected in time.') as E };
    }
  }



  async waitForBotTurnEnd<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".action-signal", { hidden: true, timeout: this.default_timeout * 15 });
    } catch (err) {
      return {
        code: "error",
        error: new Error("Failed to wait for bot's turn to end.") as E
      }
    }
    return {
      code: "success",
      data: null as D,
      msg: "Successfully waited for bot's turn to end."
    }
  }

  async getPotSize<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".table > .table-pot-size > .main-value");
      const pot_size_str = await this.page.$eval(".table > .table-pot-size > .main-value", (p: any) => p.textContent);
      return {
        code: "success",
        data: pot_size_str as D,
        msg: "Successfully retrieved table pot size."
      }
    } catch (err) {
      return {
        code: "error",
        error: new Error("Failed to retrieve table pot size.") as E
      }
    }
  }

  async getHand<D, E = Error>(): Response<D, E> {
    try {
      const cards_div = await this.page.$$(".you-player > .table-player-cards > div");
      let cards: string[] = [];
      for (const card_div of cards_div) {
        const card_value = await card_div.$eval(".value", (span: any) => span.textContent);
        const sub_suit_letter = await card_div.$eval(".sub-suit", (span: any) => span.textContent);
        if (card_value && sub_suit_letter) {
          cards.push(card_value + sub_suit_letter);
        } else {
          throw "Invalid card.";
        }
      }
      return {
        code: "success",
        data: cards as D,
        msg: "Successfully retrieved player's hand."
      }
    } catch (err) {
      return {
        code: "error",
        error: new Error("Failed to retrieve player's hand.") as E
      }
    }
  }

  async getStackSize<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".you-player > .table-player-infos-ctn > div > .table-player-stack");
      const stack_size_str = await this.page.$eval(".you-player > .table-player-infos-ctn > div > .table-player-stack", (p: any) => p.textContent);
      return {
        code: "success",
        data: stack_size_str as D,
        msg: "Successfully retrieved bot's stack size."
      }
    } catch (err) {
      return {
        code: "error",
        error: new Error("Failed to retrieve bot's stack size.") as E
      }
    }
  }

  async waitForCallOption<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .call", { timeout: this.default_timeout });
      const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .call", (button: any) => button.disabled);
      if (is_disabled) throw new Error("Call option is disabled.");
    } catch (err) {
      return { code: "error", error: new Error("No option to call available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully waited for call option." }
  }

  async call<D, E = Error>(): Response<D, E> {
    try {
      await this.page.$eval(".game-decisions-ctn > .action-buttons > .call", (button: any) => button.click());
    } catch (err) {
      return { code: "error", error: new Error("Failed to execute call action.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully executed call action." }
  }

  async waitForFoldOption<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .fold", { timeout: this.default_timeout });
      const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .fold", (button: any) => button.disabled);
      if (is_disabled) throw new Error("Fold option is disabled.");
    } catch (err) {
      return { code: "error", error: new Error("No option to fold available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully waited for fold option." }
  }

  async fold<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .fold", { timeout: this.default_timeout });
      await this.page.$eval(".game-decisions-ctn > .action-buttons > .fold", (button: any) => button.click());
    } catch (err) {
      return { code: "error", error: new Error("No option to fold available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully executed fold action." }
  }

  async cancelUnnecessaryFold<D, E = Error>(): Response<D, E> {
    const fold_alert_text = "Are you sure that you want do an unnecessary fold?Do not show this again in this session? "
    try {
      await this.page.waitForSelector(".alert-1", { timeout: this.default_timeout });
      const text = await this.page.$eval(".alert-1 > .content", (div: any) => div.textContent);
      if (text === fold_alert_text) {
        await this.page.$eval(".alert-1 > .alert-1-buttons > .button-1.red", (button: any) => button.click());
      }
    } catch (err) {
      return { code: "error", error: new Error("No option to cancel unnecessary fold available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully cancelled unnecessary fold." }
  }

  async waitForCheckOption<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .check", { timeout: this.default_timeout });
      const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .check", (button: any) => button.disabled);
      if (is_disabled) throw new Error("Check option is disabled.");
    } catch (err) {
      return { code: "error", error: new Error("No option to check available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully waited for check option." }
  }

  async check<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .check", { timeout: this.default_timeout });
      await this.page.$eval(".game-decisions-ctn > .action-buttons > .check", (button: any) => button.click());
    } catch (err) {
      return { code: "error", error: new Error("No option to check available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully executed check action." }
  }

  async waitForBetOption<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .raise", { timeout: this.default_timeout });
      const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.disabled);
      if (is_disabled) throw new Error("Bet or raise option is disabled.");
    } catch (err) {
      return { code: "error", error: new Error("No option to bet or raise available.") as E }
    }
    return { code: "success", data: null as D, msg: "Successfully waited for bet or raise option." }
  }

  async betOrRaise<D, E = Error>(bet_amount: number): Response<D, E> {
    try {
      const bet_action = await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.textContent);
      await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.click());

      if (bet_action === "Raise") {
        const res = await this.getCurrentBet();
        if (res.code === "success") {
          const current_bet = res.data as number;
          bet_amount += current_bet;
        }
      }
      await this.page.waitForSelector(".game-decisions-ctn > form > .raise-bet-value > div > input", { timeout: this.default_timeout });
      await this.page.focus(".game-decisions-ctn > form > .raise-bet-value > div > input");
      await sleep(this.default_timeout);
      await this.page.keyboard.type(bet_amount.toString(), { delay: 200 });
      await this.page.waitForSelector(".game-decisions-ctn > form > .action-buttons > .bet", { timeout: this.default_timeout });
      await this.page.$eval(".game-decisions-ctn > form > .action-buttons > .bet", (input: any) => input.click());
    } catch (err) {
      return { code: "error", error: new Error(`Failed to bet with amount ${bet_amount}.`) as E }
    }
    return { code: "success", data: null as D, msg: `Successfully executed bet action with amount ${bet_amount}.` }
  }

  async getCurrentBet<D, E = Error>(): Response<D, E> {
    try {
      const el = await this.page.waitForSelector(".you-player > .table-player-bet-value", { timeout: this.default_timeout });
      const current_bet = await this.page.evaluate((el: any) => isNaN(el.textContent) ? '0' : el.textContent, el);
      return { code: "success", data: parseFloat(current_bet) as D, msg: `Successfully retrieved current bet amount: ${current_bet}` }
    } catch (err) {
      return { code: "error", error: new Error("No existing bet amount found.") as E }
    }
  }

  async waitForHandEnd<D, E = Error>(): Response<D, E> {
    try {
      await this.page.waitForSelector(".table-player.winner", { hidden: true, timeout: this.default_timeout * 10 });
    } catch (err) {
      return { code: "error", error: new Error("Failed to wait for hand to finish.") as E }
    }
    return { code: "success", data: null as D, msg: "Waited for hand to finish." }
  }
}
