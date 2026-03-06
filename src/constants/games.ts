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
  { name: 'Ruby', platform: 'Game Boy Advance', cartridgeImage: '/images/cartridges/3-ruby.png' },
  { name: 'Sapphire', platform: 'Game Boy Advance', cartridgeImage: '/images/cartridges/3-sapphire.png' },
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
  { name: 'White 2', platform: 'Nintendo DS', cartridgeImage: '/images/cartridges/5-white2.png' },
  // Gen 6 - Nintendo 3DS
  { name: 'X', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/X.png' },
  { name: 'Y', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Y.png' },
  { name: 'Omega Ruby', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Omega Ruby.png' },
  { name: 'Alpha Sapphire', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Alpha Sapphire.png' },
  // Gen 7 - Nintendo 3DS
  { name: 'Sun', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Sun.png' },
  { name: 'Moon', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Moon.png' },
  { name: 'Ultra Sun', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Ultra Sun.png' },
  { name: 'Ultra Moon', platform: 'Nintendo 3DS', cartridgeImage: '/images/cover-art/Ultra Moon.png' },
  // Gen 8 - Nintendo Switch
  { name: "Let's Go Pikachu", platform: 'Nintendo Switch', cartridgeImage: "/images/cover-art/Let's Go Pikachu.png" },
  { name: "Let's Go Eevee", platform: 'Nintendo Switch', cartridgeImage: "/images/cover-art/Let's Go Eevee.png" },
  { name: 'Sword', platform: 'Nintendo Switch', cartridgeImage: '/images/cover-art/Sword.png' },
  { name: 'Shield', platform: 'Nintendo Switch', cartridgeImage: '/images/cover-art/Shield.png' },
  { name: 'Brilliant Diamond', platform: 'Nintendo Switch', cartridgeImage: '/images/cover-art/Brilliant Diamond.png' },
  { name: 'Shining Pearl', platform: 'Nintendo Switch', cartridgeImage: '/images/cover-art/Shining Pearl.png' },
  // Gen 9 - Switch2 row
  { name: 'Scarlett', platform: 'Switch2', cartridgeImage: '/images/cover-art/Scarlett.webp' },
  { name: 'Violet', platform: 'Switch2', cartridgeImage: '/images/cover-art/Violet.webp' },
  // Custom / other
  { name: 'Winds', platform: 'Other', cartridgeImage: '/images/cover-art/Winds.jpg' },
  { name: 'Waves', platform: 'Other', cartridgeImage: '/images/cover-art/Waves.jpg' },
]

/** Alternate game names that map to an entry in TIERLIST_GAMES (for ordering and config). */
const GAME_ALIASES: Record<string, string> = {
  'Green': 'Green (Jpn)',
  'Japanese Green': 'Green (Jpn)',
  'Green (Japanese)': 'Green (Jpn)',
  'Scarlet': 'Scarlett', // common spelling variant
}

export function getGameConfig(gameName: string): GameConfig | undefined {
  const exact = TIERLIST_GAMES.find(g => g.name === gameName)
  if (exact) return exact
  const alias = GAME_ALIASES[gameName]
  if (alias) return TIERLIST_GAMES.find(g => g.name === alias)
  const firstPart = gameName.replace(/\s+and\s+.*$/i, '').trim()
  if (firstPart !== gameName) return TIERLIST_GAMES.find(g => g.name === firstPart)
  return undefined
}

/** Index of the game in TIERLIST_GAMES (0-based). Returns Infinity if not in list (sorts to end). */
export function getGameOrder(gameName: string): number {
  const exact = TIERLIST_GAMES.findIndex(g => g.name === gameName)
  if (exact >= 0) return exact
  const alias = GAME_ALIASES[gameName]
  if (alias) return TIERLIST_GAMES.findIndex(g => g.name === alias)
  // "Red and Blue" (combined) gets its own order between Blue (2) and Yellow (3) so it doesn't stack with Red
  if (gameName === 'Red and Blue' || /red\s+and\s+blue/i.test(gameName)) {
    const blueIdx = TIERLIST_GAMES.findIndex(g => g.name === 'Blue')
    return blueIdx >= 0 ? blueIdx + 0.5 : 2.5
  }
  // e.g. other "X and Y" -> use order of first game so grouped order is correct
  const firstPart = gameName.replace(/\s+and\s+.*$/i, '').trim()
  if (firstPart !== gameName) {
    const fallback = TIERLIST_GAMES.findIndex(g => g.name === firstPart)
    if (fallback >= 0) return fallback
  }
  return Infinity
}
