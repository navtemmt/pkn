import 'dotenv/config';
import { Bot } from './bot.ts';
import ai_config_json from './configs/ai-config.json' with { type: "json" };
import bot_config_json from './configs/bot-config.json' with { type: "json" };
import webdriver_config_json from './configs/webdriver-config.json' with { type: "json" };
import { PuppeteerService } from './services/puppeteer-service.ts';
import { AIConfig, BotConfig, WebDriverConfig } from './interfaces/config-interfaces.ts';
import { AIServiceFactory } from './helpers/ai-service-factory.ts';
import { DebugMode } from './utils/error-handling-utils.ts';

// Load configurations from JSON files
const ai_config: AIConfig = ai_config_json;
const bot_config: BotConfig = bot_config_json;
const webdriver_config: WebDriverConfig = webdriver_config_json;

/**
 * Manages the bot's lifecycle: configuration, service creation, and execution.
 * @param headless_flag - Determines if the browser should run in headless mode.
 */
const bot_manager = async function(headless_flag: boolean) {
  // 1. Load and validate Game ID from environment variables
  const game_id = (process.env.GAME_ID || '').trim();
  if (!game_id) {
    throw new Error('FATAL: GAME_ID is not set in your .env file.');
  }
  console.log(`Using game ID: ${game_id}`);

  // 2. Initialize the core Puppeteer service
  const puppeteer_service = new PuppeteerService(webdriver_config.default_timeout, headless_flag);
  await puppeteer_service.init();
  
  // 3. Initialize the AI service
  const ai_service_factory = new AIServiceFactory();
  ai_service_factory.printSupportedModels();
  const ai_service = ai_service_factory.createAIService(ai_config.provider, ai_config.model_name, ai_config.playstyle);
  console.log(`Created AI service: ${ai_config.provider} ${ai_config.model_name} with playstyle: ${ai_config.playstyle}`);
  
  // 4. Create the Bot instance with the simplified constructor
  // Note: log_service and player_service are no longer needed here.
  const bot = new Bot(
    ai_service, 
    puppeteer_service, 
    game_id, 
    bot_config.debug_mode as DebugMode, 
    bot_config.query_retries,
    bot_config.manual_mode
  );
  
  // 5. Run the bot
  await bot.run();
}

export default bot_manager;
