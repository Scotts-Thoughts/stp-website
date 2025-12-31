<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspace } from '../store';
import CartridgeIcon from '../components/CartridgeIcon.vue';

defineEmits<{
    select: [index: number],
}>();

const workspace = useWorkspace();

// Filter visible tierlists
const visibleTierlists = computed(() => {
    return workspace.tierlists.filter(tierlist => tierlist.visible !== false);
});

// Separate "scott-" tierlists from the rest
const isScottTierlist = (tierlist: { filename: string }) => tierlist.filename.startsWith('scott-');

const mainTierlists = computed(() => {
    return visibleTierlists.value.filter(tierlist => !isScottTierlist(tierlist));
});

const scottTierlists = computed(() => {
    return visibleTierlists.value.filter(tierlist => isScottTierlist(tierlist));
});

// Define specific order for each platform
const gameBoyOrder = [
    'Gen 1 - Yellow Tierlist',
    'Gen 1 - Yellow Sprites',
    'Gen 1 - Red Tierlist',
    'Gen 1 - Blue Tierlist',
    'Gen 1 - Green Tierlist'
];

const gameBoyColorOrder = [
    'Gen 2 - Crystal Tierlist',
    'Gen 2 - Gold Tierlist',
    'Gen 2 - Silver Tierlist',
    'Gen 2 - Backport Races'
];

const gameBoyAdvanceOrder = [
    'Gen 3 - Ruby Tierlist',
    'Gen 3 - Sapphire Tierlist',
    'Gen 3 - Emerald Tierlist',
    'Gen 3 - FireRed Tierlist',
    'Gen 3 - FireRed Postgame Tierlist',
    'Gen 3 - LeafGreen Tierlist',
];

const nintendoDSOrder = [
    'Gen 4 - Platinum Tierlist',
    'Gen 4 - Diamond Tierlist',
    'Gen 4 - Pearl Tierlist',
    'Gen 4 - HeartGold Tierlist',
    'Gen 4 - SoulSilver Tierlist',
    'Gen 5 - Black Tierlist',
    'Gen 5 - White2 Tierlist'
];

// Combined order for Game Boy and Game Boy Color
const gameBoyCombinedOrder = [
    // Game Boy games first
    'Gen 1 - Yellow Tierlist',
    'Gen 1 - Yellow Sprites',
    'Gen 1 - Red Tierlist',
    'Gen 1 - Blue Tierlist',
    'Gen 1 - Green Tierlist',
    // Game Boy Color games second
    'Gen 2 - Crystal Tierlist',
    'Gen 2 - Gold Tierlist',
    'Gen 2 - Silver Tierlist',
    'Gen 2 - Backport Races'
];

// Group tierlists by platform with specific ordering
const gameBoyTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy')
        .sort((a, b) => {
            const aIndex = gameBoyOrder.indexOf(a.name);
            const bIndex = gameBoyOrder.indexOf(b.name);
            
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.name.localeCompare(b.name);
        });
});

const gameBoyColorTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy Color')
        .sort((a, b) => {
            const aIndex = gameBoyColorOrder.indexOf(a.name);
            const bIndex = gameBoyColorOrder.indexOf(b.name);
            
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.name.localeCompare(b.name);
        });
});

// Combined Game Boy and Game Boy Color tierlists
const gameBoyCombinedTierlists = computed(() => {
    const combined = [...gameBoyTierlists.value, ...gameBoyColorTierlists.value];
    return combined.sort((a, b) => {
        const aIndex = gameBoyCombinedOrder.indexOf(a.name);
        const bIndex = gameBoyCombinedOrder.indexOf(b.name);
        
        if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.name.localeCompare(b.name);
    });
});

// Determine if we should show combined or separate rows
// With smaller cartridges, we can fit more per row, so always combine GB/GBC
const shouldCombineGameBoyRows = computed(() => {
    return gameBoyCombinedTierlists.value.length <= 8;
});

const gameBoyAdvanceTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy Advance')
        .sort((a, b) => {
            const aIndex = gameBoyAdvanceOrder.indexOf(a.name);
            const bIndex = gameBoyAdvanceOrder.indexOf(b.name);
            
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.name.localeCompare(b.name);
        });
});

const nintendoDSTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Nintendo DS')
        .sort((a, b) => {
            const aIndex = nintendoDSOrder.indexOf(a.name);
            const bIndex = nintendoDSOrder.indexOf(b.name);
            
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.name.localeCompare(b.name);
        });
});

// Function to get cartridge color based on game name (fallback for backwards compatibility)
function getCartridgeColor(name: string): string {
    const lowerName = name.toLowerCase();
    
    // Check for specific game names first (more specific matches)
    if (lowerName.includes('firered')) return 'firered';
    if (lowerName.includes('leafgreen')) return 'leafgreen';
    if (lowerName.includes('heartgold')) return 'heartgold';
    if (lowerName.includes('soulsilver')) return 'soulsilver';
    if (lowerName.includes('black2')) return 'black2';
    if (lowerName.includes('white2')) return 'white2';
    
    // Check for general color names
    if (lowerName.includes('blue')) return 'blue';
    if (lowerName.includes('red')) return 'red';
    if (lowerName.includes('green')) return 'green';
    if (lowerName.includes('yellow')) return 'yellow';
    if (lowerName.includes('crystal')) return 'crystal';
    if (lowerName.includes('emerald')) return 'emerald';
    if (lowerName.includes('platinum')) return 'platinum';
    if (lowerName.includes('black')) return 'black';
    if (lowerName.includes('white')) return 'white';
    if (lowerName.includes('gold')) return 'gold';
    if (lowerName.includes('silver')) return 'silver';
    if (lowerName.includes('ruby')) return 'ruby';
    if (lowerName.includes('sapphire')) return 'sapphire';
    if (lowerName.includes('diamond')) return 'diamond';
    if (lowerName.includes('pearl')) return 'pearl';
    
    return 'yellow'; // default
}

// Function to determine if a cartridge is GBA based on platform
function isGBA(platform?: string): boolean {
    return platform === 'Game Boy Advance';
}

</script>


<template>
    <div class="choose-tierlist">
        <h1>Choose a Tierlist</h1>
        <div class="cartridge-grid">
            <!-- Conditional rendering: Combined or separate Game Boy rows -->
            <template v-if="shouldCombineGameBoyRows">
                <!-- Row 1: Combined Game Boy and Game Boy Color -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyCombinedTierlists" 
                        :key="i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
                
                <!-- Row 2: Game Boy Advance -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyAdvanceTierlists" 
                        :key="i + 100"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
                
                <!-- Row 3: Nintendo DS -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoDSTierlists" 
                        :key="i + 200"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
            </template>
            
            <template v-else>
                <!-- Row 1: Game Boy -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyTierlists" 
                        :key="i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
                
                <!-- Row 2: Game Boy Color -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyColorTierlists" 
                        :key="i + 50"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
                
                <!-- Row 3: Game Boy Advance -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyAdvanceTierlists" 
                        :key="i + 100"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
                
                <!-- Row 4: Nintendo DS -->
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoDSTierlists" 
                        :key="i + 200"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="t.cartridgeImage"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                        @click="$emit('select', workspace.tierlists.indexOf(t))"
                    />
                </div>
            </template>
            
            <!-- Scott's Personal Tierlists Row -->
            <div v-if="scottTierlists.length > 0" class="scott-section">
                <h2 class="scott-header">Scott's Tierlists</h2>
            </div>
            <div v-if="scottTierlists.length > 0" class="cartridge-row scott-row">
                <CartridgeIcon 
                    v-for="(t, i) in scottTierlists" 
                    :key="'scott-' + i"
                    :name="t.name"
                    :imageSource="t.imageSource"
                    :cartridgeImage="t.cartridgeImage"
                    :platform="t.platform"
                    :game="t.game"
                    :class="[getCartridgeColor(t.name), isGBA(t.platform) ? 'gba' : '']"
                    @click="$emit('select', workspace.tierlists.indexOf(t))"
                />
            </div>
        </div>
    </div>
</template>


<style scoped>
.choose-tierlist {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #222;
    border-radius: 10px;
    padding: 30px 40px;
    overflow: auto;
    width: 95vw;
    max-width: 1400px;
    max-height: 95vh;
}

.cartridge-grid {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 1300px;
    padding: 15px;
}

.cartridge-row {
    display: flex;
    justify-content: center;
    gap: 15px;
    flex-wrap: wrap;
}

.scott-section {
    width: 100%;
    margin-top: 10px;
    padding-top: 15px;
    border-top: 2px solid #444;
    text-align: center;
}

.scott-header {
    color: #ffffff;
    font-family: 'TitanOne', 'Arial Black', sans-serif;
    font-size: 1.5rem;
    margin: 0;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.scott-row {
    margin-top: 0;
}

h1 {
    color: white;
    font-family: 'TitanOne', 'Arial Black', sans-serif;
    font-size: 2.5rem;
    margin: 0;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}
</style>
