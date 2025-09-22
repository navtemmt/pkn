import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Bot } from './bot';
import { PuppeteerService } from './services/puppeteer-service';
import { AIConfig, BotConfig, WebDriverConfig } from './interfaces/config-interfaces';
import { AIServiceFactory } from './helpers/ai-service-factory';
import { DebugMode } from './utils/error-handling-utils';

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load JSON configs without import attributes
const ai_config_json = JSON.parse(
  readFileSync(resolve(__dirname, './configs/ai-config.json'), 'utf-8')
);
const bot_config_json = JSON.parse(
  readFileSync(resolve(__dirname, './configs/bot-config.json'), 'utf-8')
);
const webdriver_config_json = JSON.parse(
  readFileSync(resolve(__dirname, './configs/webdriver-config.json'), 'utf-8')
);

// Strongly typed views
const ai_config: AIConfig = ai_config_json as AIConfig;
const bot_config: BotConfig = bot_config_json as BotConfig;
const webdriver_config: WebDriverConfig = webdriver_config_json as WebDriverConfig;

/**
 * Manages the bot's lifecycle: configuration, service creation, and execution.
 * @param headless_flag - Determines if the browser should run in headless mode.
 */
const bot_manager = async function (headless_flag: boolean) {
  // 1. Load and validate Game ID from environment variables
  const game_id = (process.env.GAME_ID || '').trim();
  if (!game_id) {
    throw new Error('FATAL: GAME_ID is not set in your .env file.');
  }
  console.log(`Using game ID: ${game_id}`);

  // 2. Initialize the core Puppeteer service
  const puppeteer_service = new PuppeteerService(
    webdriver_config.default_timeout,
    headless_flag
  );
  await puppeteer_service.init();

  // 3. Initialize the AI service
  const ai_service_factory = new AIServiceFactory();
  ai_service_factory.printSupportedModels();
  const ai_service = ai_service_factory.createAIService(
    ai_config.provider,
    ai_config.model_name,
    ai_config.playstyle
  );
  console.log(
    `Created AI service: ${ai_config.provider} ${ai_config.model_name} with playstyle: ${ai_config.playstyle}`
  );

  // 4. Create the Bot instance
  const bot = new Bot(
    ai_service,
    puppeteer_service,
    game_id,
    bot_config.debug_mode as DebugMode,
    bot_config.query_retries,
    // If manual_mode is absent in your schema, set a default (e.g., true) or remove this param.
    bot_config.manual_mode as boolean
  );

  // 5. Run the bot
  await bot.run();
};

export default bot_manager;
