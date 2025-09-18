import { prompt } from 'enquirer';
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
    private manual_mode: boolean = true; // NEW: Flag for manual vs auto mode
    private paused: boolean = false; // NEW: Pause/resume capability

    constructor(log_service: LogService, 
                ai_service: AIService,
                player_service: PlayerService,
                puppeteer_service: PuppeteerService,
                game_id: string,
                debug_mode: DebugMode,
                query_retries: number,
                manual_mode: boolean = true) // NEW: Manual mode parameter
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
                await this.advisoryOneHand(); // NEW: Advisory mode
            } else {
                await this.playOneHand(); // Original automated mode
            }
            
            this.hand_history = [];
            this.table.nextHand();
        }
    }

    // NEW: Advisory version of playOneHand that doesn't execute actions
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

                    // Get current game state
                    const pot_size = await this.getPotSize();
                    const hand = await this.getHand();
                    const stack_size = await this.getStackSize();
                    
                    this.table.setPot(convertToBBs(pot_size, this.game.getBigBlind()));
                    await this.updateHero(hand, convertToBBs(stack_size, this.game.getBigBlind()));
                    
                    // Process logs and get AI advice
                    await postProcessLogs(this.table.getLogsQueue(), this.game);
                    const query = constructQuery(this.game);
                    
                    try {
                        console.log("🤖 Getting AI recommendation...");
                        const bot_action = await this.queryBotAction(query, this.query_retries);
                        await this.displayAdvice(bot_action); // NEW: Display instead of execute
                        this.table.resetPlayerActions();
                    } catch (err) {
                        console.log("❌ Failed to get AI advice:", err);
                        await this.displayFallbackAdvice();
                    }

                    // Wait for user to execute manually
                    await this.waitForUserExecution();
                    
                } else if (data.includes("winner")) {
                    console.log("🏆 Hand completed - winner detected");
                    break;
                }
            }
        }

        // End of hand processing
        const res = await this.puppeteer_service.getStackSize();
        if (res.code === "success") {
            console.log("📊 Final stack size:", res.data);
        }

        try {
            processed_logs = await this.pullAndProcessLogs(this.first_created, processed_logs.first_fetch);
            await postProcessLogsAfterHand(processed_logs.valid_msgs, this.game);
            await this.table.processPlayers();
        } catch (err) {
            console.log("Failed to process end-of-hand stats:", err);
        }

        await this.puppeteer_service.waitForHandEnd();
        console.log("✅ Hand completed\n");
    }

    // NEW: Display AI recommendation instead of executing
    private async displayAdvice(bot_action: BotAction): Promise<void> {
        const hero = this.game.getHero();
        const pot_bb = this.table.getPot();
        const stack_bb = hero ? hero.getStackSize() : 0;
        
        console.log("\n" + "🎲".repeat(30));
        console.log("🤖 AI RECOMMENDATION");
        console.log("🎲".repeat(30));
        console.log(`💰 Pot: ${pot_bb} BB | 🏦 Your Stack: ${stack_bb} BB`);
        console.log(`🃏 Your Hand: ${hero?.getHand().join(', ') || 'Unknown'}`);
        console.log("");
        console.log(`🎯 RECOMMENDED ACTION: ${bot_action.action_str.toUpperCase()}`);
        
        if (bot_action.bet_size_in_BBs > 0) {
            const bet_size_value = convertToValue(bot_action.bet_size_in_BBs, this.game.getBigBlind());
            console.log(`💸 Size: ${bot_action.bet_size_in_BBs} BB (${bet_size_value} chips)`);
            
            if (pot_bb > 0) {
                const pot_percentage = (bot_action.bet_size_in_BBs / pot_bb * 100).toFixed(1);
                console.log(`📊 Pot %: ${pot_percentage}% of pot`);
            }
        }

        // Add player stats if available
        const opponents = this.game.getTable().getActivePlayers();
        if (opponents.length > 0) {
            console.log("\n📈 OPPONENT STATS:");
            for (const player of opponents.slice(0, 3)) { // Show top 3
                try {
                    const stats = await this.player_service.getStatsForPrompt(player.getName());
                    console.log(`   ${stats}`);
                } catch (err) {
                    console.log(`   ${player.getName()}: No data`);
                }
            }
        }

        console.log("\n⚠️  EXECUTE THIS ACTION MANUALLY ON POKERNOW ⚠️");
        console.log("🎲".repeat(30) + "\n");
    }

    // NEW: Fallback advice when AI fails
    private async displayFallbackAdvice(): Promise<void> {
        console.log("\n❌ AI advice unavailable - showing basic options:");
        
        const validActions = await this.getValidActions();
        console.log("✅ Available actions:", validActions.join(", "));
        console.log("💡 Suggested: Check if possible, otherwise fold");
        console.log("⚠️  Make your decision manually on PokerNow\n");
    }

    // NEW: Get available actions without executing
    private async getValidActions(): Promise<string[]> {
        const actions: string[] = [];
        
        if ((await this.puppeteer_service.waitForCheckOption()).code === "success") {
            actions.push("check");
        }
        if ((await this.puppeteer_service.waitForCallOption()).code === "success") {
            actions.push("call");
        }
        if ((await this.puppeteer_service.waitForBetOption()).code === "success") {
            actions.push("bet/raise");
        }
        if ((await this.puppeteer_service.waitForFoldOption()).code === "success") {
            actions.push("fold");
        }
        
        return actions;
    }

    // NEW: Wait for user to execute the action manually
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

        switch (response.action) {
            case 'pause':
                this.paused = true;
                console.log("⏸️  Advisor paused. Use resume command to continue.");
                break;
            case 'different':
                console.log("📝 Action noted - continuing to monitor...");
                break;
            case 'skip':
                console.log("⏭️  Skipping - continuing to monitor...");
                break;
            default:
                console.log("✅ Continuing to monitor for next decision...");
        }
    }

    // NEW: Handle pause/resume
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

        if (response.action === 'resume') {
            this.paused = false;
            console.log("▶️  Advisor resumed");
        } else if (response.action === 'quit') {
            console.log("👋 Exiting advisor...");
            process.exit(0);
        }
    }

    // NEW: User confirmation helper
    private async performBotAction(bot_action: BotAction): Promise<void> {
    // SAFETY: Prevent automated execution in manual mode
    if (this.manual_mode) {
        console.log("🛡️  MANUAL MODE: Action execution disabled for safety");
        console.log("⚠️  Execute manually on PokerNow:", bot_action.action_str);
        return;
    }
    
    // Optional: Double confirmation for automated mode
    if (process.env.NODE_ENV !== 'development') {
        const confirm = await this.promptUserConfirmation(
            `🚨 Execute ${bot_action.action_str} automatically? This carries ban risk!`
        );
        if (!confirm) {
            console.log("❌ Automated execution cancelled by user");
            return;
        }
    }

    console.log("🤖 Executing Bot Action:", bot_action.action_str);
    let bet_size = convertToValue(bot_action.bet_size_in_BBs, this.game.getBigBlind());
    
    switch (bot_action.action_str) {
        case "bet":
            console.log("Bet Size:", convertToBBs(bet_size, this.game.getBigBlind()));
            logResponse(await this.puppeteer_service.betOrRaise(bet_size), this.debug_mode);
            break;
        case "raise":
            console.log("Bet Size:", convertToBBs(bet_size, this.game.getBigBlind()));
            logResponse(await this.puppeteer_service.betOrRaise(bet_size), this.debug_mode);
            break;
        case "all-in":
            bet_size = convertToValue(this.game.getHero()!.getStackSize(), this.game.getBigBlind());
            console.log("Bet Size:", convertToBBs(bet_size, this.game.getBigBlind()));
            logResponse(await this.puppeteer_service.betOrRaise(bet_size), this.debug_mode);
            break;
        case "call":
            logResponse(await this.puppeteer_service.call(), this.debug_mode);
            break;
        case "check":
            logResponse(await this.puppeteer_service.check(), this.debug_mode);
            break;
        case "fold":
            logResponse(await this.puppeteer_service.fold(), this.debug_mode);
            const res = await this.puppeteer_service.cancelUnnecessaryFold();
            if (res.code === "success") {
                logResponse(await this.puppeteer_service.check(), this.debug_mode);
            }
            break;
    }
}

