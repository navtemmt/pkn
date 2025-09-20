import readline from 'readline';

/**
 * Computes a worst-case timeout for a poker hand.
 * @param num_players - The number of players.
 * @param max_turn_length - The maximum time a player has for a turn, in seconds.
 * @param num_streets - The number of betting rounds (e.g., pre-flop, flop, turn, river = 4).
 * @returns The total computed timeout in milliseconds.
 */
export function computeTimeout(num_players: number, max_turn_length: number, num_streets: number): number {
    return 1000 * (num_players - 1) * max_turn_length * num_streets;
}

/**
 * Pauses the execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the specified duration.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pauses the script and waits for the user to press the Enter key in the console.
 * @param query - The message to display to the user.
 * @returns A promise that resolves when the user presses Enter.
 */
export function waitForEnter(query: string = 'Press Enter to continue...'): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, () => {
    rl.close();
    resolve();
  }));
}
