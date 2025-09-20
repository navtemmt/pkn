import Enquirer from 'enquirer';
import { sleep } from './helpers/bot-helper.ts';
import { AIService, BotAction } from './interfaces/ai-client-interfaces.ts';
import { Game } from './models/game.ts';
import { Table } from './models/table.ts';
import { GameState, PuppeteerService } from './services/puppeteer-service.ts';
import { constructQuery } from './helpers/construct-query-helper.ts';
import { DebugMode, logResponse } from './utils/error-handling-utils.ts';
import { convertToBBs } from './utils/value-conversion-utils.ts';

const prompt = (options: any): Promise<any> => new Enquirer().prompt(options);

export class Bot {
    private ai_service: AIService;
    private puppeteer_service: PuppeteerService;
    private game_id: string;
    private query_retries: number;
    private table!: Table;
    private game!: Game;
    private manual_mode: boolean = true;
    private paused: boolean = false;

    constructor(
        ai_service: AIService,
        puppeteer_service: PuppeteerService,
        game_id: string,
        _debug_mode: DebugMode, // underscore to indicate it's not used internally
        query_retries: number,
        manual_mode: boolean = true
    ) {
        this.ai_service = ai_service;
        this.puppeteer_service = puppeteer_service;
        this.game_id = game_id;
        this.query_retries = query_retries;
        this.manual_mode = manual_mode;
    }

    public async run() {
        await this.openGame();
        this.table = new Table();
        this.game = new Game(this.game_id, this.table, 2, 1, 'NLH', 30);

        if (this.manual_mode) {
            console.log("🎯 MANUAL ADVISOR MODE");
            await this.promptUserConfirmation("Ready to start advisory mode?");
        }

        while (true) {
            if (this.paused) {
                await this.handlePauseMode();
                continue;
            }
            console.log("\n🔄 Waiting for a new hand to start or for your turn...");
            await this.advisoryOneHand();
            this.table.nextHand();
        }
    }

    private async advisoryOneHand() {
        while (true) {
            try { // PATCH: Added try...catch for robustness
                console.log("👀 Monitoring for your turn or hand end...");
                await sleep(3000); 

                const gameState = await this.puppeteer_service.getTableState();

                if (!gameState || !gameState.players.some(p => p.isSelf)) {
                    console.log("Could not find hero player on table. Retrying...");
                    continue;
                }
                
                const self = gameState.players.find(p => p.isSelf);

                if (self && self.isCurrentTurn) {
                    console.log("\n" + "🎯".repeat(20) + "\n🚨 IT'S YOUR TURN! 🚨\n" + "🎯".repeat(20));
                    this.updateModelsFromState(gameState);
                    const query = constructQuery(this.game);
                    
                    try {
                        console.log("🤖 Getting AI recommendation...");
                        const bot_action = await this.queryBotAction(query, this.query_retries);
                        await this.displayAdvice(bot_action);
                    } catch (err) {
                        console.log("❌ Failed to get AI advice:", err);
                        await this.displayFallbackAdvice();
                    }
                    await this.waitForUserExecution();

                } else if (this.isHandOver(gameState)) {
                    console.log("🏆 Hand completed.");
                    this.updateModelsFromState(gameState); 
                    break; 
                }
            } catch (error) {
                console.error("An error occurred in the advisory loop. Retrying...", error);
                await sleep(5000); // Wait before retrying to avoid spamming errors
            }
        }
    }

    private updateModelsFromState(gameState: GameState) {
        this.table.clearPlayers();
        gameState.players.forEach(playerState => {
            const player = this.table.addPlayer(playerState.name, playerState.stack, playerState.seat);
            player.setBet(playerState.bet);
        });
        
        this.game.setPot(convertToBBs(gameState.pot, this.game.getBigBlind()));
        this.game.setCommunityCards(gameState.communityCards);

        const selfState = gameState.players.find(p => p.isSelf);
        if (selfState) {
            const hero = this.table.getHero();
            if (hero) {
                hero.setHand(selfState.holeCards);
                hero.setStack(convertToBBs(selfState.stack, this.game.getBigBlind()));
            } else {
                this.table.setHero(selfState.name);
            }
        }
    }

    private isHandOver(gameState: GameState): boolean {
        const activePlayers = gameState.players.filter(p => !p.isFolded).length;
        const isShowdown = gameState.communityCards.length === 5; 
        return activePlayers <= 1 || (isShowdown && !gameState.players.some(p => p.isCurrentTurn));
    }

    private async openGame() {
        console.log(`The PokerNow game with id: ${this.game_id} will now open.`);
        const navigateResponse = await this.puppeteer_service.navigateToGame(this.game_id);
        logResponse(navigateResponse);
        if (navigateResponse.code === 'error') {
            throw new Error('Failed to open game.');
        }
    }

    private async displayAdvice(bot_action: BotAction): Promise<void> {
        console.log(`\n💡 AI Recommendation: ${bot_action.action.toUpperCase()}`);
        if (bot_action.amount) console.log(`   Amount: ${bot_action.amount}`);
        console.log(`   Reasoning: ${bot_action.reasoning}\n`);
    }

    private async displayFallbackAdvice(): Promise<void> {
        console.log("\n💡 Fallback Advice: CHECK or FOLD\n   Reasoning: Could not get a confident read from the AI.\n");
    }

    private async waitForUserExecution(): Promise<void> {
        const { action } = await prompt<{action: string}>({
            type: 'select',
            name: 'action',
            message: 'Waiting for you to act. What next?',
            choices: ['✅ I have acted, continue monitoring.', '⏸️  Pause advisor.']
        });
        if (action.includes('Pause')) this.paused = true;
    }

    private async handlePauseMode(): Promise<void> {
        const { action } = await prompt<{action: string}>({
            type: 'select',
            name: 'action',
            message: '⏸️  Advisor is paused. What would you like to do?',
            choices: ['▶️  Resume advisory', '🚪 Quit application']
        });
        if (action.includes('Resume')) this.paused = false;
        else if (action.includes('Quit')) process.exit(0);
    }

    private async promptUserConfirmation(message: string): Promise<void> {
        const { confirmed } = await prompt<{confirmed: boolean}>({ type: 'confirm', name: 'confirmed', message });
        if (!confirmed) process.exit(0);
    }

    private async queryBotAction(query: string, retries: number): Promise<BotAction> {
        try {
            return await this.ai_service.getAction(query);
        } catch (e) {
            if (retries > 0) {
                await sleep(1000);
                return this.queryBotAction(query, retries - 1);
            }
            throw e;
        }
    }
}
