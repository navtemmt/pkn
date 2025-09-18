import clipboardy from 'clipboardy';
import { prompt } from 'enquirer';
import { AIMessage, AIResponse, AIService, BotAction } from "../../interfaces/ai-client-interfaces.ts";
import { getPromptFromPlaystyle, parseResponse} from "../../helpers/ai-query-helper.ts";

export class ManualChatGPTService extends AIService {
    init(): void {
        console.log("🤖 Manual ChatGPT Service initialized");
        console.log("💡 Make sure ChatGPT is open in your browser");
    }
    
    async query(input: string, prev_messages: AIMessage[]): Promise<AIResponse> {
        // Build message history (same logic as original)
        if (prev_messages.length > 0) {
            if (input !== prev_messages[prev_messages.length - 1].text_content) {
                prev_messages.push({text_content: input, metadata: {"role": "user"}});
            }
        } else {
            try {
                const playstyle_prompt = getPromptFromPlaystyle(this.getPlaystyle());
                prev_messages = [
                    {text_content: playstyle_prompt, metadata: {"role": "system"}},
                    {text_content: input, metadata: {"role": "user"}}
                ];
            } catch (err) {
                console.log(err);
                prev_messages = [
                    {text_content: input, metadata: {"role": "user"}}
                ];
            }
        }

        // Format for manual copy-paste
        const formatted_prompt = this.formatForChatGPT(prev_messages);
        
        // Auto-copy to clipboard
        await clipboardy.write(formatted_prompt);
        
        console.log("\n" + "=".repeat(50));
        console.log("🔥 PROMPT COPIED TO CLIPBOARD!");
        console.log("📋 Paste this in ChatGPT:");
        console.log("=".repeat(50));
        console.log(formatted_prompt);
        console.log("=".repeat(50));
        
        // Wait for user to paste response
        const response: any = await prompt({
            type: 'input',
            name: 'chatgpt_response',
            message: '🎯 Paste ChatGPT response here and press Enter:'
        });

        const text_content = response.chatgpt_response;
        let bot_action: BotAction = {
            action_str: "",
            bet_size_in_BBs: 0
        };

        if (text_content) {
            bot_action = parseResponse(text_content);
        }

        // Add AI response to message history
        prev_messages.push({
            text_content: text_content,
            metadata: {"role": "assistant"}
        });

        return {
            bot_action: bot_action,
            prev_messages: prev_messages,
            curr_message: {
                text_content: text_content,
                metadata: {
                    "role": "assistant"
                }
            }
        };
    }

    private formatForChatGPT(messages: AIMessage[]): string {
        let formatted = "";
        
        for (const message of messages) {
            if (message.metadata.role === "system") {
                formatted += `[SYSTEM PROMPT]\n${message.text_content}\n\n`;
            } else if (message.metadata.role === "user") {
                formatted += `[USER REQUEST]\n${message.text_content}\n\n`;
            }
        }
        
        return formatted.trim();
    }
}
