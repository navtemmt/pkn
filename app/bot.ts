// Corrected app/bot.ts

import Enquirer from 'enquirer'; // Corrected: Use default import
import { sleep } from './helpers/bot-helper.ts';
import { AIService, BotAction, defaultCheckAction, defaultFoldAction } from './interfaces/ai-client-interfaces.ts';
import { ProcessedLogs } from './interfaces/log-processing-interfaces.ts';
import { Game } from './models/game.ts';
import { Table } from './models/table.ts';
import { LogService } from './services/log-service.ts';
import { PlayerService } from './services/player-service.ts';
import { PuppeteerService } from './services/puppeteer-service.ts';
import { constructQuery } from './helpers/construct-query-helper.ts';
import { DebugMode, logResponse } from './utils/error-handling-utils.ts';
import { postProcessLogs, postProcessLogsAfterHand, preProcessLogs } from './utils/log-processing-utils.ts';
import { getIdToInitialStackFromMsg, getIdToNameFromMsg, getIdToTableSeatFromMsg, getNameToIdFromMsg, getPlayerStacksMsg, getTableSeatToIdFromMsg, validateAllMsg } from './utils/message-processing-utils.ts';
import { convertToBBs, convertToValue } from './utils/value-conversion-utils.ts';

// Helper for enquirer prompts
const prompt = (options: any) => new Enquirer().prompt(options);

export class Bot {
    private log_service: LogService;
    private ai_service: AIService;
    private player_service: PlayerService;
    private puppeteer_service: PuppeteerService;
    private game_id: string;
    private debug_mode: DebugMode;
    private query_retries: number;
    private first_created: string;
    private hand_history: any;
    private table!: Table;
    private game!: Game;
    private bot_name!: string;
    private manual_mode: boolean = true;
    private paused: boolean = false;

    constructor(log_service: LogService,
                ai_service: AIService,
                player_service: PlayerService,
                puppeteer_service: PuppeteerService,
                game_id: string,
                debug_mode: DebugMode,
                query_retries: number,
                manual_mode: boolean = true)
    {
        this.log_service = log_service;
        this.ai_service = ai_service;
        this.player_service = player_service;
        this.puppeteer_service = puppeteer_service;
        this.game_id = game_id;
        this.debug_mode = debug_mode;
        this.query_retries = query_retries;
        this.manual_mode = manual_mode;
        this.first_created = "";
        this.hand_history = [];
    }

    public async run() {
        await this.openGame();

        if (this.manual_mode) {
            console.log("🎯 MANUAL ADVISOR MODE");
            console.log("⚠️  Bot will provide advice but NOT execute actions automatically");
            console.log("🎮 You must manually click buttons on PokerNow");
            await this.promptUserConfirmation("Ready to start advisory mode?");
        }
        await this.enterTableInProgress();
        await this.updateNumPlayers();

        while (true) {
            if (this.paused) {
                await this.handlePauseMode();
                continue;
            }
            await this.waitForNextHand();
            await this.updateNumPlayers();
            await this.updateGameInfo();
            console.log("Number of players in game:", this.table.getNumPlayers());
            this.table.setPlayersInPot(this.table.getNumPlayers());

            if (this.manual_mode) {
                await this.advisoryOneHand();
            } else {
                await this.playOneHand();
            }

            this.hand_history = [];
            this.table.nextHand();
        }
    }

    private async advisoryOneHand() {
        let processed_logs = {
            valid_msgs: new Array<Array<string>>,
            last_created: this.first_created,
            first_fetch: true
        };
        while (true) {
            console.log("👀 Monitoring for your turn or hand end...");
            const res = await this.puppeteer_service.waitForBotTurnOrWinner(this.table.getNumPlayers(), this.game.getMaxTurnLength());

            if (res.code == "success") {
                const data = res.data as string;

                if (data.includes("action-signal")) {
                    try {
                        await sleep(2000);
                        processed_logs = await this.pullAndProcessLogs(processed_logs.last_created, processed_logs.first_fetch);
                    } catch (err) {
                        console.log("Failed to pull logs.");
                        continue;
                    }
                    console.log("\n" + "🎯".repeat(20));
                    console.log("🚨 IT'S YOUR TURN! 🚨");
                    console.log("🎯".repeat(20));

                    const pot_size = await this.getPotSize();
                    const hand = await this.getHand();
                    const stack_size = await this.getStackSize();

                    this.table.setPot(convertToBBs(pot_size, this.game.getBigBlind()));
                    await this.updateHero(hand, convertToBBs(stack_size, this.game.getBigBlind()));

                    await postProcessLogs(this.table.getLogsQueue(), this.game);
                    const query = constructQuery(this.game);

                    try {
                        console.log("🤖 Getting AI recommendation...");
                        const bot_action = await this.queryBotAction(query, this.query_retries);
                        await this.displayAdvice(bot_action);
                        this.table.resetPlayerActions();
                    } catch (err) {
                        console.log("❌ Failed to get AI advice:", err);
                        await this.displayFallbackAdvice();
                    }
                    await this.waitForUserExecution();

                } else if (data.includes("winner")) {
                    console.log("🏆 Hand completed - winner detected");
                    break;
                }
            }
        }

        const resAfterHand = await this.puppeteer_service.getStackSize();
        if (resAfterHand.code === "success") {
            console.log("📊 Final stack size:", resAfterHand.data);
        }
        try {
            processed_logs = await this.pullAndProcessLogs(this.first_created, processed_logs.first_fetch);
            await postProcessLogsAfterHand(processed_logs.valid_msgs, this.game);
            // await this.table.processPlayers(); // This requires DB, disable for now if using mock
        } catch (err) {
            console.log("Failed to process end-of-hand stats:", err);
        }
        await this.puppeteer_service.waitForHandEnd();
        console.log("✅ Hand completed\n");
    }

    private async displayAdvice(bot_action: BotAction): Promise<void> {
        // ... (this method is correct from your paste)
    }

    private async displayFallbackAdvice(): Promise<void> {
        // ... (this method is correct from your paste)
    }

    private async getValidActions(): Promise<string[]> {
        // ... (this method is correct from your paste)
    }

    private async waitForUserExecution(): Promise<void> {
        const response: any = await prompt({
            type: 'select',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: 'executed', message: '✅ I executed the recommended action' },
                { name: 'different', message: '🔄 I chose a different action' },
                { name: 'pause', message: '⏸️  Pause advisor' },
                { name: 'skip', message: '⏭️  Skip this decision' }
            ]
        });
        // ... (rest of the method is correct)
    }

    private async handlePauseMode(): Promise<void> {
        const response: any = await prompt({
            type: 'select',
            name: 'action',
            message: '⏸️  Advisor is paused. What would you like to do?',
            choices: [
                { name: 'resume', message: '▶️  Resume advisory' },
                { name: 'quit', message: '🚪 Quit advisor' }
            ]
        });
        // ... (rest of the method is correct)
    }

    private async promptUserConfirmation(message: string): Promise<boolean> {
        const response: any = await prompt({
            type: 'confirm',
            name: 'confirmed',
            message: message
        });
        return response.confirmed;
    }

    private async performBotAction(bot_action: BotAction): Promise<void> {
        // ... (this method is correct from your paste)
    }

    // --- Original Bot Methods (Restored) ---

    // Inside app/bot.ts

    private async openGame() {
        console.log(`The PokerNow game with id: ${this.game_id} will now open.`);
        const navigateResponse = await this.puppeteer_service.navigateToGame(this.game_id);
        logResponse(navigateResponse);
    
        if (navigateResponse.code === 'error') {
            throw new Error('Failed to open game.');
        }
        // All game info logic has been removed, as it will now be handled by getTableState()
    }


    private async enterTableInProgress() {
      // Prefer environment variables; fall back to prompts if missing
      const envName = (process.env.HERO_NAME || '').trim();
      const envStackRaw = (process.env.HERO_STACK || '').trim();
      const envStack =
        envStackRaw !== '' && !Number.isNaN(Number(envStackRaw)) ? Number(envStackRaw) : undefined;
    
      // Optional: observation-only mode skips any seat/join attempts
      if (process.env.ADVISOR_OBSERVE === '1') {
        console.log("Observation mode enabled; skipping seating/join.");
        return;
      }
    
      while (true) {
        // Use env name if provided, otherwise prompt
        const nameResponse: any =
          envName
            ? { name: envName }
            : await prompt({ type: 'input', name: 'name', message: 'What is your desired player name?' });
        this.bot_name = (nameResponse.name || '').trim();
    
        // Use env stack if provided, otherwise prompt
        const stackResponse: any =
          envStack !== undefined
            ? { stack: String(envStack) }
            : await prompt({ type: 'input', name: 'stack', message: 'What is your desired stack size?' });
        const stack_size = Number(stackResponse.stack);
    
        console.log(`Attempting to enter table with name: ${this.bot_name} and stack size: ${stack_size}.`);
        const code = logResponse(
          await this.puppeteer_service.sendEnterTableRequest(this.bot_name, stack_size),
          this.debug_mode
        );
    
        if (code === "success") break;
    
        console.log("Please try again.");
        // If env values failed (e.g., name taken), loop will prompt next time unless env still set
        // To force prompt next loop when env is set, clear envName/envStack here if desired.
      }
    
      console.log("Waiting for table host to accept ingress request.");
      logResponse(await this.puppeteer_service.waitForTableEntry(), this.debug_mode);
    }
    

    private async updateNumPlayers() { /* ... from original */ }
    private async waitForNextHand() { /* ... from original */ }
    private async playOneHand() { /* ... from original */ }
    private async updateGameInfo() { /* ... from original */ }
    private async pullAndProcessLogs(last_created: string, first_fetch: boolean): Promise<ProcessedLogs> { /* ... from original */ }
    private async getPotSize(): Promise<number> { /* ... from original */ }
    private async getHand(): Promise<string[]> { /* ... from original */ }
    private async getStackSize(): Promise<number> { /* ... from original */ }
    private async updateHero(hand: string[], stack_size: number): Promise<void> { /* ... from original */ }
    private async queryBotAction(query: string, retries: number): Promise<BotAction> { /* ... from original */ }
    private async isValidBotAction(bot_action: BotAction): Promise<boolean> { /* ... from original */ }
}
