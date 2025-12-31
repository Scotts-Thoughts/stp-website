<script setup lang="ts">
import { useToast } from '../store';

const toastContext = useToast();
</script>


<template>
    <div class="toast-container">
        <div v-for="toast in toastContext.toasts">
            <div class="toast" :class="toast.type">
                <div class="message">{{ toast.message }}</div>
                <div class="close" @click="toastContext.removeToast(toast.id)">&times;</div>
                <div v-if="toast.pending" class="pending-bar"></div>
            </div>
        </div>
    </div>
</template>


<style scoped>
.toast-container {
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 300px;
    font-family: Consolas, monospace;
}

.toast {
    position: relative;
    padding: 10px;
    border-radius: 5px;
    background: #333;
    color: white;
    width: 100%;
    overflow: hidden;
    opacity: 0.8;
    transition: opacity 0.5s;
}

.toast:hover {
    opacity: 1;
}

.toast .message {
    padding-right: 20px;
}

.toast .pending-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 20%;
    height: 5px;
    border-radius: 5px;
    background-color:#fff8;
    animation: pending-bar-scroll 1s linear infinite;
}

@keyframes pending-bar-scroll {
    0% { left: -20%; }
    100% { left: 100%; }
}

.toast .close {
    position: absolute;
    top: 5px;
    right: 5px;
    cursor: pointer;
    font-size: 25px;
    width: 24px;
    height: 24px;
    text-align: center;
    line-height: 22px;
}
.toast .close:hover {
    background: #fff2;
}

.toast.error { background: #d32f2f; }
.toast.warning { background: #f57c00; }
.toast.info { background: #1976d2; }
.toast.success { background: #388e3c; }

</style>
