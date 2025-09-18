// app/services/ocr-service.ts
import easyocr from 'easyocr';

export class OCRService {
  private reader = new easyocr.Reader(['en']);

  async parseTableState(screenshot: Buffer): Promise<any> {
    const results = await this.reader.readtext(screenshot);
    
    return {
      pot: this.extractPot(results),
      blinds: this.extractBlinds(results),
      stacks: this.extractStacks(results),
      cards: this.extractCards(results),
      // ... more extraction logic
    };
  }
}
