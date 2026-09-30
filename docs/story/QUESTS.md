# ANTISUYU: Quest Graph & Implementation Details

This document defines the implementation-ready quest structure, the exact flags for the save system, and the character roles/motives that drive the progression.

## Persistence Contract (Save System Schema)
The save system must store the following data. The schema version should be tracked (e.g., `schema_v1`).
*   **Version:** `schema_v1`
*   **Player State:** Position (`x, y, z`), rotation, current scene/region ID, health/stamina (if applicable).
*   **Quest Flags:** A dictionary of boolean flags matching the exact names defined below (e.g., `{"q_act1_ruin_infiltrated": true}`).
*   **Inventory/Progression:** Acquired items (e.g., `item_quipu_fragment`, `item_bronze_mirror`), solved puzzle states.
*   **World State:** Dynamic changes based on quests (e.g., `world_blockade_active`, `world_tunnel_collapsed`).

---

## Character Roles & Motives

### Naira Quispe (Player Character)
*   **Role:** Archaeologist, outsider-ally.
*   **Motive:** Initially, to protect artifacts from the black market. Later, to protect the land and heritage of the Andean community from erasure by corporate mining interests.

### Vargas (Antagonist)
*   **Role:** Leader of Sol Negro, ruthless pragmatist.
*   **Motive:** Land clearance and resource extraction. The antiquities are a bonus to fund the operation; his true goal is to dynamite the ruins (Paititi) to secure a massive rare-earth mining concession, intentionally erasing the community's ancestral claim to the territory.
*   **Escalation Arc:** Starts by aggressively excavating (Act I), reveals the mining plot (Act II), resorts to indiscriminate explosives (Act III), and attempts to destroy the central plaza to secure his claim (Act IV).

### Tayta Tomas (Community Leader)
*   **Role:** Quechua elder, guide, and tactical leader of the local resistance.
*   **Function:** Not a passive victim. He organizes the road blockades, understands the deep cave systems, and leads the vanguard to hold off Vargas's mercenaries in Act III.

---

## Quest List & Flags

### Act I: The Cloud Forest
**Quest: The Blockade**
*   **Stage 1:** Arrive at the blockade. Speak with Tayta Tomas.
    *   *Flag:* `q_act1_met_tomas`
*   **Stage 2:** Infiltrate the Sol Negro dig site.
    *   *Flag:* `q_act1_ruin_infiltrated`
*   **Stage 3:** Solve the Quipu Cipher to open the lower chamber.
    *   *Flag:* `q_act1_quipu_solved`
    *   *Consequence:* Naira learns the true path; Sol Negro is delayed.

### Act II: The High Sierra
**Quest: The Navel**
*   **Stage 1:** Reach the Chakana Gate. Observe Vance and Tomas arguing.
    *   *Flag:* `q_act2_chakana_reached`
*   **Stage 2:** Solve the Southern Cross alignment puzzle to open the Chakana Gate.
    *   *Flag:* `q_act2_chakana_solved`
*   **Stage 3:** Manipulate the Sayhuite Map Table to reveal the descent path.
    *   *Flag:* `q_act2_sayhuite_solved`
*   **Stage 4:** Confront Vargas at the Outpost. Learn the mining concession motive.
    *   *Flag:* `q_act2_outpost_confrontation`
    *   *Consequence:* The stakes shift; Vargas begins using heavy explosives.

### Act III: The Jungle Lowlands
**Quest: Descent into Uku Pacha**
*   **Stage 1:** Navigate the Serpent's Path (water/Amaru puzzles).
    *   *Flag:* `q_act3_amaru_navigated`
*   **Stage 2:** Traverse the Trembling Tunnels, avoiding collapsed sections.
    *   *Flag:* `q_act3_tunnels_survived`
*   **Stage 3:** Reach the Vanguard Choke Point. Help Tomas secure the barricade.
    *   *Flag:* `q_act3_vanguard_secured`
    *   *Consequence:* Vargas's reinforcements are cut off; Naira proceeds alone to Paititi.

### Act IV: Paititi
**Quest: The Sun's Refuge**
*   **Stage 1:** Enter Paititi. Reach the Plaza of the Sun.
    *   *Flag:* `q_act4_paititi_entered`
*   **Stage 2:** Confront Vargas in the Sanctuary.
    *   *Flag:* `q_act4_sanctuary_confrontation`
*   **Stage 3:** Complete the Grand Observatory alignment puzzle.
    *   *Flag:* `q_act4_observatory_aligned`
    *   *Consequence:* The solar resonance triggers; Vargas is defeated by the collapsing environment; the city is secured. Game completed.
