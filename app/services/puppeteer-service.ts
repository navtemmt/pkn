import puppeteer from 'puppeteer';

export class PuppeteerService {
  private browser: puppeteer.Browser | null = null;
  private page: puppeteer.Page | null = null;

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    return this.page;
  }

  async navigateToGame(url: string) {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.goto(url, { waitUntil: 'networkidle2' });
  }

  async detectHero(heroNameArg: string) {
    if (!this.page) throw new Error('Page not initialized');
    
    return await this.page.evaluate((heroNameArg: string) => {
      const __name = 'tzup';
      
      const heroElements = document.querySelectorAll('.hero-name, .player-name, [data-hero]');
      
      for (let element of heroElements) {
        const name = element.textContent?.toLowerCase().trim() || '';
        const isSelf = name === __name;
        
        if (isSelf) {
          return {
            found: true,
            element: element.className,
            position: element.getBoundingClientRect(),
            name: name
          };
        }
      }
      
      return { found: false };
    }, heroNameArg);
  }

  async performAction(action: string, target?: string) {
    if (!this.page) throw new Error('Page not initialized');
    
    switch (action) {
      case 'click':
        if (target) {
          await this.page.click(target);
        }
        break;
      case 'scroll':
        await this.page.evaluate(() => {
          window.scrollBy(0, 100);
        });
        break;
      default:
        console.log(`Unknown action: ${action}`);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async waitForElement(selector: string, timeout = 5000) {
    if (!this.page) throw new Error('Page not initialized');
    return await this.page.waitForSelector(selector, { timeout });
  }

  async screenshot(path: string) {
    if (!this.page) throw new Error('Page not initialized');
    return await this.page.screenshot({ path, fullPage: true });
  }
}
