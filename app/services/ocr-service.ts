// app/services/ocr-service.ts
import Tesseract from 'tesseract.js';
import sharp from 'sharp';

export class OCRService {
  async parseTableState(screenshot: Buffer): Promise<any> {
    // Preprocess image for better OCR accuracy
    const processedImage = await sharp(screenshot)
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();

    // Extract text from image
    const { data: { text } } = await Tesseract.recognize(processedImage, 'eng', {
      tessedit_char_whitelist: '0123456789.,KMB$' // Limit to poker-relevant characters
    });

    return this.parsePokerText(text);
  }

  private parsePokerText(text: string): any {
    // Parse pot, blinds, stacks from OCR text
    const potMatch = text.match(/Pot[:\s]*([0-9,]+)/i);
    const blindsMatch = text.match(/([0-9,]+)\/([0-9,]+)/);
    
    return {
      pot: potMatch ? parseInt(potMatch[1].replace(/,/g, '')) : 0,
      smallBlind: blindsMatch ? parseInt(blindsMatch[1].replace(/,/g, '')) : 0,
      bigBlind: blindsMatch ? parseInt(blindsMatch[2].replace(/,/g, '')) : 0,
      // Add more parsing logic as needed
    };
  }
}
