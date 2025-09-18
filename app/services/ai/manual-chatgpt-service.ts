import clipboardy from 'clipboardy';
import { prompt } from 'enquirer';
import { AIMessage, AIResponse, AIService, BotAction } from "../../interfaces/ai-client-interfaces.ts";
import { getPromptFromPlaystyle, parseResponse } from "../../helpers/ai-query-helper.ts";

export class ManualChatGPTService extends AIService {
    constructor(model_name: string, playstyle: string) {
        super(model_name, playstyle);
        console.log("🤖 Manual ChatGPT Service Initialized.");
        console.log("   -> Ready to copy prompts to your clipboard.");
    }

    async query(input: string, prev_messages: AIMessage[]): Promise<AIResponse> {
        // Build the full prompt including system message and previous conversation
        const full_prompt = this.buildFullPrompt(input, prev_messages);

        // Automatically copy the generated prompt to the user's clipboard
        await clipboardy.write(full_prompt);

        console.log("\n" + "=".repeat(60));
        console.log("✅ PROMPT COPIED TO CLIPBOARD!");
        console.log("   Navigate to ChatGPT, paste the prompt, and get the response.");
        console.log("=".repeat(60));
        console.log(full_prompt);
        console.log("=".repeat(60));

        // Wait for the user to manually paste the response from ChatGPT
        const response: any = await prompt({
            type: 'input',
            name: 'chatgpt_response',
            message: 'PASTE ChatGPT response here and press Enter:'
        });

        const text_content = response.chatgpt_response;
        let bot_action: BotAction = { action_str: "fold", bet_size_in_BBs: 0 }; // Default to fold

        if (text_content) {
            try {
                bot_action = parseResponse(text_content);
            } catch (e) {
                console.error("Error parsing ChatGPT response:", e);
                console.log("Defaulting to FOLD action.");
            }
        }

        // Return the structured response for the bot to use
        return {
            bot_action: bot_action,
            prev_messages: [...prev_messages, { text_content: input, metadata: { "role": "user" } }],
            curr_message: {
                text_content: text_content,
                metadata: { "role": "assistant" }
            }
        };
    }

    private buildFullPrompt(current_input: string, prev_messages: AIMessage[]): string {
        let prompt_string = "";
        
        // Add system prompt if it's the first message
        if (prev_messages.length === 0) {
            const playstyle_prompt = getPromptFromPlaystyle(this.getPlaystyle());
            prompt_string += `[SYSTEM PROMPT]\n${playstyle_prompt}\n\n`;
        }

        // Append previous user/assistant messages for context
        for (const message of prev_messages) {
            const role = message.metadata.role.toUpperCase();
            prompt_string += `[${role}]\n${message.text_content}\n\n`;
        }

        // Add the current user input
        prompt_string += `[USER]\n${current_input}`;

        return prompt_string.trim();
    }
}
