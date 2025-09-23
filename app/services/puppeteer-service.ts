        let pot = 0;
        const potEl = document.querySelector('.main-value .normal-value') as HTMLElement;
        if (potEl) {
          pot = parseValue(potEl.textcontent as any);
        }
        // Blinds
        const blinds: number[] = [];
        const blindElements = document.querySelectorAll('.blind-value-ctn .normal-value');
        blindElements.forEach((blindEl) => {
          const blindValue = parseValue((blindEl as HTMLElement).textContent);
          if (blindValue > 0) {
            blinds.push(blindValue);
          }
        });
        // Action buttons
        const actionButtons: string[] = [];
        const buttonElements = document.querySelectorAll('button.action-button');
        buttonElements.forEach((btnEl) => {
          const buttonText = (btnEl as HTMLElement).textContent?.trim() || '';
          if (buttonText) {
            actionButtons.push(buttonText);
          }
        });
        // Use the hero name passed as argument
        const heroNameNormalized = (heroNameArg || '').trim().toLowerCase();
        try { console.log('Hero name being searched for:', heroNameArg); } catch {}
        // If hero name provided, align isSelf based on heroNameArg (in case .you-player missing)
        if (heroNameNormalized) {
          for (const p of players) {
            if ((p.name || '').trim().toLowerCase() === heroNameNormalized) {
              (p as any).isSelf = true;
            }
          }
        }
        // Action turn: check for suspended signal or decision-current on you-player
        let actionTurn = false;
        const suspendedSignal = document.querySelector('.action-signal.suspended');
        const heroDecisionCurrent = document.querySelector('.you-player .decision-current');
        actionTurn = !!(suspendedSignal || heroDecisionCurrent);
        // Expose actionTurn and heroCards by augmenting return if consumer widens type later
        const hero = players.find((p) => p.isSelf) || null;
        const heroCards = hero ? hero.holeCards : [];
        return {
          players,
          communityCards,
          pot,
          actionTurn,
          heroCards,
          blinds,
          actionButtons,
        } as any;
      }, heroName);
      // Node-side logging: evaluate returned successfully
      console.log('[getTableState] Evaluate returned summary:', {
        playersCount: result?.players?.length,
        heroCards: result?.heroCards,
        actionButtons: result?.actionButtons,
        actionTurn: result?.actionTurn,
      });
      return result;
    } catch (e) {
      console.error('[getTableState] Error during evaluate or parsing:', e);
      return null;
    }
  }
}
