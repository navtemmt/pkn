import puppeteer from 'puppeteer';

export class PuppeteerService {
  private browser: puppeteer.Browser | null = null;
  private page: puppeteer.Page | null = null;

  async init() {
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
