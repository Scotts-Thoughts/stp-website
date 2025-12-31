<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  name: string
  image?: string
  game?: string
  imageSource?: string
  platform?: string
  cartridgeImage?: string
}

const props = defineProps<Props>()

defineEmits<{
  click: []
}>()

// Use cartridgeImage from JSON, then imageSource, then fall back to image prop
// Convert absolute paths to relative for Electron compatibility
const displayImage = computed(() => {
  const src = props.cartridgeImage || props.imageSource || props.image
  if (!src) return undefined
  // Convert absolute paths like /images/... to relative ./images/...
  if (src.startsWith('/')) {
    return '.' + src
  }
  return src
})
</script>

<template>
  <div class="cartridge" @click="$emit('click')">
    <div class="cartridge-body">
      <div class="cartridge-label">
        <div class="label-content">
          <div class="game-image" v-if="displayImage">
            <img :src="displayImage" :alt="name" />
          </div>
          <div class="game-image placeholder" v-else>
            <div class="placeholder-icon">🎮</div>
          </div>
          <div class="game-title">{{ name }}</div>
          <div class="game-subtitle" v-if="game">{{ game }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cartridge {
  width: 140px;
  height: 160px;
  cursor: pointer;
  transition: transform 0.2s ease, filter 0.2s ease;
  position: relative;
}

.cartridge.gba {
  width: 160px;
  height: 140px;
}

.cartridge:hover {
  transform: translateY(-5px);
  filter: brightness(1.1);
}

.cartridge-body {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #d4af37 0%, #b8941f 50%, #9a7b1a 100%);
  border-radius: 8px 8px 4px 4px;
  position: relative;
  box-shadow: 
    0 4px 8px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
}

.cartridge-label {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  bottom: 8px;
  background: linear-gradient(135deg, #f4e4bc 0%, #e6d7a3 50%, #d4c08a 100%);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 
    inset 0 1px 2px rgba(0, 0, 0, 0.1),
    inset 0 -1px 2px rgba(255, 255, 255, 0.3);
}

.label-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.game-image {
  width: 100px;
  height: 100px;
  margin-bottom: 8px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.cartridge.gba .game-image {
  width: 120px;
  height: 100px;
}

.game-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.game-image.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ecf0f1 0%, #bdc3c7 100%);
  border: 2px dashed #95a5a6;
}

.placeholder-icon {
  font-size: 24px;
  opacity: 0.6;
}

.game-title {
  font-family: 'TitanOne', 'Arial Black', sans-serif;
  font-size: 11px;
  font-weight: bold;
  color: #2c3e50;
  line-height: 1.1;
  margin-bottom: 2px;
  text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.5);
}

.cartridge.gba .game-title {
  font-size: 10px;
}

.game-subtitle {
  font-family: 'Play', 'Arial', sans-serif;
  font-size: 8px;
  color: #34495e;
  font-weight: normal;
  line-height: 1;
}


/* Different cartridge colors for different games */
.cartridge.blue .cartridge-body {
  background: linear-gradient(135deg, #4a90e2 0%, #357abd 50%, #2c5aa0 100%);
}

.cartridge.red .cartridge-body {
  background: linear-gradient(135deg, #c73d2e 0%, #ad3325 50%, #801f16 100%);
}

.cartridge.green .cartridge-body {
  background: linear-gradient(135deg, #1e8449 0%, #196f3d 50%, #145a32 100%);
}

.cartridge.yellow .cartridge-body {
  background: linear-gradient(135deg, #f1c511 0%, #d4ac0d 50%, #b7950b 100%);
}

.cartridge.crystal .cartridge-body {
  background: linear-gradient(135deg, #72bcce 0%, #569daf 50%, #3f8496 100%);
}

.cartridge.emerald .cartridge-body {
  background: linear-gradient(135deg, #3aa755 0%, #158531 50%, #065f1c 100%);
}

.cartridge.firered .cartridge-body {
  background: linear-gradient(135deg, #ff6b35 0%, #db5528 50%, #b33f18 100%);
}

.cartridge.heartgold .cartridge-body {
  background: linear-gradient(135deg, #f39c12 0%, #e67e22 50%, #d35400 100%);
}

.cartridge.platinum .cartridge-body {
  background: linear-gradient(135deg, #bdc3c7 0%, #95a5a6 50%, #7f8c8d 100%);
}

.cartridge.black .cartridge-body {
  background: linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 50%, #1a1a1a 100%);
}

.cartridge.white .cartridge-body {
  background: linear-gradient(135deg, #ecf0f1 0%, #bdc3c7 50%, #95a5a6 100%);
}

.cartridge.gold .cartridge-body {
  background: linear-gradient(135deg, #9c8011 0%, #967b0e 50%, #614e02 100%);
}

.cartridge.silver .cartridge-body {
  background: linear-gradient(135deg, #ae9bb6 0%, #8d7c94 50%, #706375 100%);
}

.cartridge.leafgreen .cartridge-body {
  background: linear-gradient(135deg, #51f767 0%, #29dd41 50%, #0bd326 100%);
}

.cartridge.soulsilver .cartridge-body {
  background: linear-gradient(135deg, #bdc3c7 0%, #95a5a6 50%, #7f8c8d 100%);
}

.cartridge.black2 .cartridge-body {
  background: linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 50%, #0d0d0d 100%);
}

.cartridge.white2 .cartridge-body {
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 50%, #dee2e6 100%);
}

.cartridge.ruby .cartridge-body {
  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 50%, #a93226 100%);
}

.cartridge.sapphire .cartridge-body {
  background: linear-gradient(135deg, #3498db 0%, #2980b9 50%, #1f618d 100%);
}

.cartridge.diamond .cartridge-body {
  background: linear-gradient(135deg, #62a6d3 0%, #3a87bb 50%, #1977b6 100%);
}

.cartridge.pearl .cartridge-body {
  background: linear-gradient(135deg, #c7a7aa 0%, #c5989c 50%, #85555a 100%);
}
</style>
