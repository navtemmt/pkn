import clipboardy from 'clipboardy';
import Enquirer from 'enquirer'; // Corrected: Use default import
import { AIMessage, AIResponse, AIService, BotAction } from "../../interfaces/ai-client-interfaces.ts";
import { getPromptFromPlaystyle, parseResponse } from "../../helpers/ai-query-helper.ts";

export class ManualChatGPTService extends AIService {
    constructor(model_name: string, playstyle: string) {
        super(model_name, playstyle);
        console.log("🤖 Manual ChatGPT Service Initialized.");
        console.log("   -> Ready to copy prompts to your clipboard.");
    }

    async query(input: string, prev_messages: AIMessage[]): Promise<AIResponse> {
        const full_prompt = this.buildFullPrompt(input, prev_messages);
        await clipboardy.write(full_prompt);

        console.log("\n" + "=".repeat(60));
        console.log("✅ PROMPT COPIED TO CLIPBOARD!");
        console.log("   Navigate to ChatGPT, paste the prompt, and get the response.");
        console.log("=".repeat(60));
        console.log(full_prompt);
        console.log("=".repeat(60));

        // Corrected: Instantiate Enquirer before using it
        const enquirer = new Enquirer();
        const response: any = await enquirer.prompt({
            type: 'input',
            name: 'chatgpt_response',
            message: 'PASTE ChatGPT response here and press Enter:'
        });

        const text_content = response.chatgpt_response;
        let bot_action: BotAction = { action_str: "fold", bet_size_in_BBs: 0 };

        if (text_content) {
            try {
                bot_action = parseResponse(text_content);
            } catch (e) {
                console.error("Error parsing ChatGPT response:", e);
                console.log("Defaulting to FOLD action.");
            }
        }

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
        
        if (prev_messages.length === 0) {
            const playstyle_prompt = getPromptFromPlaystyle(this.getPlaystyle());
            prompt_string += `[SYSTEM PROMPT]\n${playstyle_prompt}\n\n`;
        }

        for (const message of prev_messages) {
            const role = message.metadata.role.toUpperCase();
            prompt_string += `[${role}]\n${message.text_content}\n\n`;
        }

        prompt_string += `[USER]\n${current_input}`;
        return prompt_string.trim();
    }
}
