// app/services/ai/puppeteer-chatgpt-service.ts
import puppeteer from 'puppeteer';

export class PuppeteerChatGPTService {
  private browser: any;
  private page: any;

  async initialize(): Promise<void> {
    this.browser = await puppeteer.launch({ headless: false });
    this.page = await this.browser.newPage();
    await this.page.goto('https://chat.openai.com');
    
    // Wait for user to log in manually first time
    console.log("Please log into ChatGPT and press Enter...");
    await prompt({ type: 'input', name: 'ready', message: 'Ready? (Enter)' });
  }

  async getDecision(gameState: any): Promise<string> {
    const formattedPrompt = this.formatGameStateForChatGPT(gameState);
    
    // Auto-submit to ChatGPT
    await this.page.waitForSelector('textarea');
    await this.page.click('textarea');
    await this.page.keyboard.type(formattedPrompt);
    await this.page.keyboard.press('Enter');
    
    // Wait for response
    await this.page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 30000 });
    
    const response = await this.page.evaluate(() => {
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      return messages[messages.length - 1]?.textContent || '';
    });
    
    return response;
  }
}
