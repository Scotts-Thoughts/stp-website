/**
 * Available games for creating new tierlists.
 * Platform is used for grouping and cartridge styling; cartridgeImage is optional path to custom art.
 */
export type GameConfig = {
  name: string
  platform: string
  cartridgeImage?: string
}

export const TIERLIST_GAMES: GameConfig[] = [
  // Gen 1 - Game Boy
  { name: 'Green (Jpn)', platform: 'Game Boy' },
  { name: 'Red', platform: 'Game Boy' },
  { name: 'Blue', platform: 'Game Boy' },
  { name: 'Yellow', platform: 'Game Boy' },
  // Gen 2 - Game Boy Color
  { name: 'Gold', platform: 'Game Boy Color' },
  { name: 'Silver', platform: 'Game Boy Color' },
  { name: 'Crystal', platform: 'Game Boy Color' },
  // Gen 3 - Game Boy Advance
  { name: 'Ruby', platform: 'Game Boy Advance' },
  { name: 'Sapphire', platform: 'Game Boy Advance' },
  { name: 'Emerald', platform: 'Game Boy Advance' },
  { name: 'FireRed', platform: 'Game Boy Advance' },
  { name: 'LeafGreen', platform: 'Game Boy Advance' },
  // Gen 4 - Nintendo DS
  { name: 'Diamond', platform: 'Nintendo DS' },
  { name: 'Pearl', platform: 'Nintendo DS' },
  { name: 'Platinum', platform: 'Nintendo DS' },
  { name: 'HeartGold', platform: 'Nintendo DS' },
  { name: 'SoulSilver', platform: 'Nintendo DS' },
  // Gen 5 - Nintendo DS
  { name: 'Black', platform: 'Nintendo DS' },
  { name: 'White', platform: 'Nintendo DS' },
  { name: 'Black 2', platform: 'Nintendo DS' },
  { name: 'White 2', platform: 'Nintendo DS' },
  // Gen 6 - Nintendo 3DS
  { name: 'X', platform: 'Nintendo 3DS' },
  { name: 'Y', platform: 'Nintendo 3DS' },
  { name: 'Omega Ruby', platform: 'Nintendo 3DS' },
  { name: 'Alpha Sapphire', platform: 'Nintendo 3DS' },
  // Gen 7 - Nintendo 3DS
  { name: 'Sun', platform: 'Nintendo 3DS' },
  { name: 'Moon', platform: 'Nintendo 3DS' },
  { name: 'Ultra Sun', platform: 'Nintendo 3DS' },
  { name: 'Ultra Moon', platform: 'Nintendo 3DS' },
  // Gen 8 - Nintendo Switch
  { name: 'Sword', platform: 'Nintendo Switch' },
  { name: 'Shield', platform: 'Nintendo Switch' },
  // Gen 9 - Nintendo Switch (Switch2 row)
  { name: 'Scarlett', platform: 'Switch2' },
  { name: 'Violet', platform: 'Switch2' },
  // Gen 8 remakes (after Gen 9 in list order)
  { name: 'Brilliant Diamond', platform: 'Nintendo Switch' },
  { name: 'Shining Pearl', platform: 'Nintendo Switch' },
  // Custom / other
  { name: 'Winds', platform: 'Other' },
  { name: 'Waves', platform: 'Other' },
]

export function getGameConfig(gameName: string): GameConfig | undefined {
  return TIERLIST_GAMES.find(g => g.name === gameName)
}

/** Index of the game in TIERLIST_GAMES (0-based). Returns Infinity if not in list (sorts to end). */
export function getGameOrder(gameName: string): number {
  const i = TIERLIST_GAMES.findIndex(g => g.name === gameName)
  return i >= 0 ? i : Infinity
}
