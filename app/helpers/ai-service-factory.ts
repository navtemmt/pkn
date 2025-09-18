// app/helpers/ai-service-factory.ts

import { AIService } from "../interfaces/ai-client-interfaces.ts";
import { ManualChatGPTService } from "../services/ai/manual-chatgpt-service.ts";
// Note: Imports for GoogleAIService and OpenAIService have been removed.

export class AIServiceFactory {
    /**
     * Creates and returns an AI service instance.
     * For the manual workflow, this factory is simplified to always return 
     * the ManualChatGPTService, regardless of the provider specified in the config.
     *
     * @param provider - The AI provider from the config (e.g., "MANUAL_CHATGPT"). This is now ignored.
     * @param model_name - The name of the model to use (e.g., "gpt-4o").
     * @param playstyle - The desired playstyle for the bot (e.g., "TAG").
     * @returns An instance of ManualChatGPTService.
     */
    createAIService(provider: string, model_name: string, playstyle: string = "neutral"): AIService {
        console.log("🤖 AI Service Factory is creating a service...");
        
        // In this modified workflow, we always use the ManualChatGPTService.
        // This simplifies the setup and removes the need for API keys and other service files.
        console.log(`   -> Config provider '${provider}' found, but we are defaulting to ManualChatGPTService.`);
        
        const manualService = new ManualChatGPTService(model_name, playstyle);
        console.log("   -> ManualChatGPTService instance created successfully.");

        return manualService;
    }

    /**
     * This method is kept for compatibility but is no longer relevant in manual mode.
     */
    printSupportedModels(): void {
        console.log("✅ AI Service is configured for Manual ChatGPT mode.");
        console.log("   -> No specific models are required as you will be using the ChatGPT web interface.");
    }
}
