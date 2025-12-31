<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core';

import { useTierlist } from '../store';
import { currentDate } from '../utils/time';

const props = defineProps<{
    visible: boolean
}>();

const emit = defineEmits<{
    close: []
}>();

const tierlist = useTierlist();
const popupRef = ref<HTMLDivElement>();

// Calendar navigation state (doesn't affect filter until date is selected)
const currentMonth = ref(new Date());
const selectedDate = ref<string>(tierlist.releaseDateTreshold);

// Watch for visibility changes to sync with current filter
watch(() => props.visible, async (visible) => {
    if (visible) {
        selectedDate.value = tierlist.releaseDateTreshold;
        // Set current month to the selected date's month
        if (tierlist.releaseDateTreshold) {
            currentMonth.value = new Date(tierlist.releaseDateTreshold);
        } else {
            currentMonth.value = new Date();
        }
        // Focus the popup to enable keyboard shortcuts
        await nextTick();
        popupRef.value?.focus();
    }
});

// Calendar generation
const calendarDays = computed(() => {
    const year = currentMonth.value.getFullYear();
    const month = currentMonth.value.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const days = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 42; i++) {
        days.push({
            date: new Date(currentDate),
            isCurrentMonth: currentDate.getMonth() === month,
            isSelected: currentDate.toISOString().split('T')[0] === selectedDate.value,
            isToday: currentDate.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
        });
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
});

const monthYear = computed(() => {
    return currentMonth.value.toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
    });
});

// Navigation functions
function previousMonth() {
    currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1, 1);
}

function nextMonth() {
    currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1, 1);
}

// Date selection
function selectDate(date: Date) {
    const dateString = date.toISOString().split('T')[0];
    selectedDate.value = dateString;
    tierlist.releaseDateTreshold = dateString;
}

// Close popup when clicking outside
onClickOutside(popupRef, () => {
    if (props.visible) {
        emit('close');
    }
});

function resetToCurrentDate() {
    const today = currentDate();
    selectedDate.value = today;
    tierlist.releaseDateTreshold = today;
    currentMonth.value = new Date(today);
}

function setToMaxDate() {
    const maxDate = '2099-01-01';
    selectedDate.value = maxDate;
    tierlist.releaseDateTreshold = maxDate;
    currentMonth.value = new Date(maxDate);
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
        e.preventDefault();
    } else if (e.key === 'a' || e.key === 'A') {
        previousMonth();
        e.preventDefault();
    } else if (e.key === 's' || e.key === 'S') {
        nextMonth();
        e.preventDefault();
    } else if (e.key === 'w' || e.key === 'W') {
        resetToCurrentDate();
        e.preventDefault();
    } else if (e.key === 'e' || e.key === 'E') {
        setToMaxDate();
        e.preventDefault();
    }
}
</script>

<template>
    <div 
        v-if="visible" 
        class="quick-calendar-overlay"
    >
        <div 
            ref="popupRef" 
            class="quick-calendar-popup"
            @keydown="handleKeydown"
            tabindex="0"
        >
            <div class="quick-calendar-header">
                <span>Quick Date Filter</span>
                <button class="close-button" @click="$emit('close')" title="Close">×</button>
            </div>
            <div class="quick-calendar-content">
                <div class="date-input-group">
                    <label>Release Date: {{ selectedDate }}</label>
                    <div class="date-controls">
                        <button 
                            class="icon-button" 
                            @click="resetToCurrentDate" 
                            title="Reset to Current Date (W)"
                        >
                            &#x21bb;
                        </button>
                        <button 
                            class="icon-button" 
                            @click="setToMaxDate" 
                            title="Set to Max Date (E)"
                        >
                            &#x221e;
                        </button>
                    </div>
                </div>
                
                <div class="calendar-container">
                    <div class="calendar-header">
                        <button class="nav-button" @click="previousMonth" title="Previous Month (A)">‹</button>
                        <span class="month-year">{{ monthYear }}</span>
                        <button class="nav-button" @click="nextMonth" title="Next Month (S)">›</button>
                    </div>
                    
                    <div class="calendar-grid">
                        <div class="day-header">Su</div>
                        <div class="day-header">Mo</div>
                        <div class="day-header">Tu</div>
                        <div class="day-header">We</div>
                        <div class="day-header">Th</div>
                        <div class="day-header">Fr</div>
                        <div class="day-header">Sa</div>
                        
                        <div 
                            v-for="day in calendarDays" 
                            :key="day.date.toISOString()"
                            class="calendar-day"
                            :class="{
                                'other-month': !day.isCurrentMonth,
                                'selected': day.isSelected,
                                'today': day.isToday
                            }"
                            @click="selectDate(day.date)"
                        >
                            {{ day.date.getDate() }}
                        </div>
                    </div>
                </div>
                
            </div>
        </div>
    </div>
</template>

<style scoped>
.quick-calendar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
}

.quick-calendar-popup {
    background-color: #2a2a2a;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    min-width: 300px;
    max-width: 400px;
    animation: popup-enter 0.2s ease-out;
    outline: none;
}

@keyframes popup-enter {
    from {
        opacity: 0;
        transform: scale(0.9) translateY(-10px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

.quick-calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #444;
    background-color: #333;
    border-radius: 8px 8px 0 0;
}

.quick-calendar-header span {
    font-weight: bold;
    color: #fff;
}

.close-button {
    background: none;
    border: none;
    color: #ccc;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 0.2s;
}

.close-button:hover {
    background-color: #444;
    color: #fff;
}

.quick-calendar-content {
    padding: 16px;
}

.date-input-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.date-input-group label {
    color: #ccc;
    font-size: 14px;
    font-weight: 500;
}

.date-controls {
    display: flex;
    align-items: center;
    gap: 8px;
}

.date-input {
    flex: 1;
    padding: 8px 12px;
    background-color: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s;
}

.date-input:focus {
    border-color: #007acc;
}

.icon-button {
    background-color: #333;
    border: 1px solid #444;
    color: #ccc;
    padding: 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
    min-width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.icon-button:hover {
    background-color: #444;
    color: #fff;
    border-color: #555;
}


.calendar-container {
    margin-top: 16px;
}

.calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.nav-button {
    background-color: #333;
    border: 1px solid #444;
    color: #ccc;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s;
    min-width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.nav-button:hover {
    background-color: #444;
    color: #fff;
    border-color: #555;
}

.month-year {
    color: #fff;
    font-weight: bold;
    font-size: 16px;
}

.calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}

.day-header {
    padding: 8px;
    text-align: center;
    font-size: 12px;
    font-weight: bold;
    color: #888;
    background-color: #1a1a1a;
    border-radius: 4px;
}

.calendar-day {
    padding: 8px;
    text-align: center;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
    background-color: #2a2a2a;
    color: #ccc;
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.calendar-day:hover {
    background-color: #444;
    color: #fff;
}

.calendar-day.other-month {
    color: #666;
    background-color: #1a1a1a;
}

.calendar-day.other-month:hover {
    background-color: #333;
    color: #888;
}

.calendar-day.selected {
    background-color: #007acc;
    color: #fff;
}

.calendar-day.today {
    border: 2px solid #007acc;
}

.calendar-day.today.selected {
    background-color: #007acc;
    color: #fff;
}
</style>
