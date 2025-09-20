import Enquirer from 'enquirer';
import { sleep } from './helpers/bot-helper.ts';
import { AIService, BotAction } from './interfaces/ai-client-interfaces.ts';
import { Game } from './models/game.ts';
import { Table } from './models/table.ts';
import { GameState, PuppeteerService } from './services/puppeteer-service.ts';
import { constructQuery } from './helpers/construct-query-helper.ts';
import { DebugMode, logResponse, Response } from './utils/error-handling-utils.ts';
import { convertToBBs } from './utils/value-conversion-utils.ts';

const prompt = (options: any): Promise<any> => new Enquirer().prompt(options);

export class Bot {
    private ai_service: AIService;
    private puppeteer_service: PuppeteerService;
    private game_id: string;
    private debug_mode: DebugMode;
    private query_retries: number;
    private hand_history: any[];
    private table!: Table;
    private game!: Game;
    private manual_mode: boolean = true;
    private paused: boolean = false;

    constructor(
        ai_service: AIService,
        puppeteer_service: PuppeteerService,
        game_id: string,
        debug_mode: DebugMode,
        query_retries: number,
        manual_mode: boolean = true
    ) {
        this.ai_service = ai_service;
        this.puppeteer_service = puppeteer_service;
        this.game_id = game_id;
        this.debug_mode = debug_mode;
        this.query_retries = query_retries;
        this.manual_mode = manual_mode;
        this.hand_history = [];
    }

    public async run() {
        await this.openGame();

        // Initialize Table and Game with placeholder values. They will be updated on the first hand.
        this.table = new Table();
        this.game = new Game(this.game_id, this.table, 2, 1, 'NLH', 30); // Default blinds 1/2

        if (this.manual_mode) {
            console.log("🎯 MANUAL ADVISOR MODE");
            console.log("⚠️  Bot will provide advice but NOT execute actions automatically");
            console.log("🎮 You must manually click buttons on PokerNow");
            await this.promptUserConfirmation("Ready to start advisory mode?");
        }

        while (true) {
            if (this.paused) {
                await this.handlePauseMode();
                continue;
            }

            console.log("\n🔄 Waiting for a new hand to start or for your turn...");
            
            if (this.manual_mode) {
                await this.advisoryOneHand();
            } else {
                console.log("Full automation not implemented. Please run in manual mode.");
                break;
            }
            this.hand_history = [];
            this.table.nextHand();
        }
    }

    private async advisoryOneHand() {
        while (true) {
            console.log("👀 Monitoring for your turn or hand end...");
            await sleep(3000); 

            const gameState = await this.puppeteer_service.getTableState();

            if (!gameState) {
                console.log("Could not capture table state. Retrying...");
                continue;
            }

            const self = gameState.players.find(p => p.isSelf);

            if (self && self.isCurrentTurn) {
                console.log("\n" + "🎯".repeat(20));
                console.log("🚨 IT'S YOUR TURN! 🚨");
                console.log("🎯".repeat(20));

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
        }
    }

    private updateModelsFromState(gameState: GameState) {
        this.table.clearPlayers();
        gameState.players.forEach(playerState => {
            this.table.addPlayer(playerState.name, playerState.stack, playerState.seat);
            const player = this.table.getPlayer(playerState.name);
            if (player) {
                player.setBet(playerState.bet);
                // Future logic for player status can be added here
            }
        });
        
        this.game.setBigBlind(2); 
        this.game.setSmallBlind(1);
        this.game.setPot(convertToBBs(gameState.pot, this.game.getBigBlind()));
        this.game.setCommunityCards(gameState.communityCards);

        const self = gameState.players.find(p => p.isSelf);
        if (self) {
            this.updateHero(self.holeCards, convertToBBs(self.stack, this.game.getBigBlind()));
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
        logResponse(navigateResponse as any);

        if ((navigateResponse as any).code === 'error') {
            throw new Error('Failed to open game.');
        }
    }

    private async displayAdvice(bot_action: BotAction): Promise<void> {
        console.log("\n💡 AI Recommendation:");
        console.log(`   Action: ${bot_action.action.toUpperCase()}`);
        if (bot_action.action === 'bet' || bot_action.action === 'raise') {
            console.log(`   Amount: ${bot_action.amount}`);
        }
        console.log(`   Reasoning: ${bot_action.reasoning}\n`);
    }

    private async displayFallbackAdvice(): Promise<void> {
        console.log("\n💡 Fallback Advice:");
        console.log("   Action: CHECK or FOLD");
        console.log("   Reasoning: Could not get a confident read from the AI. Playing safe is advised.\n");
    }

    private async waitForUserExecution(): Promise<void> {
        const response: any = await prompt({
            type: 'select',
            name: 'action',
            message: 'Waiting for you to act. What next?',
            choices: [
                { name: 'acted', message: '✅ I have acted, continue monitoring.' },
                { name: 'pause', message: '⏸️  Pause advisor.' },
            ]
        });

        if (response.action === 'pause') {
            this.paused = true;
        }
    }

    private async handlePauseMode(): Promise<void> {
        const response: any = await prompt({
            type: 'select',
            name: 'action',
            message: '⏸️  Advisor is paused. What would you like to do?',
            choices: [
                { name: 'resume', message: '▶️  Resume advisory' },
                { name: 'quit', message: '🚪 Quit application' }
            ]
        });

        if (response.action === 'resume') {
            this.paused = false;
        } else if (response.action === 'quit') {
            process.exit(0);
        }
    }

    private async promptUserConfirmation(message: string): Promise<boolean> {
        const response: any = await prompt({ type: 'confirm', name: 'confirmed', message });
        return response.confirmed;
    }

    private async queryBotAction(query: string, retries: number): Promise<BotAction> {
        try {
            return await this.ai_service.getAction(query);
        } catch (e) {
            if (retries > 0) {
                console.log(`AI query failed. Retrying... (${retries} left)`);
                await sleep(1000);
                return this.queryBotAction(query, retries - 1);
            }
            throw e;
        }
    }
    
    private updateHero(hand: string[], stack_size: number): void {
        const hero = this.table.getHero();
        if (hero) {
            hero.setHand(hand);
            hero.setStack(stack_size);
        }
    }
}
