<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import Window from '../components/Window.vue'
import DropdownSelect from '../components/DropdownSelect.vue';

import { useTierlist } from '../store';
import { formatTimeHMS, formatTimeFull, parseTime, formatDate, parseDate } from '../utils/time';

const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const GAMETIME_PATTERN = "(-1)|(([1-9]\\d*|0)(:\\d\\d){1,2})";
const REALTIME_PATTERN = "([1-9]\\d*|0)(:\\d\\d){1,2}(\\.\\d\\d)?";


const tierlist = useTierlist();
const attemptIndex = ref(0);
const maxAttemptIndex = ref(0);
const tags = ref([] as string[]);

// Calculate centered position for the window
const centeredPosition = computed(() => {
    const windowWidth = 400;
    const windowHeight = 500; // Use consistent height for centering
    
    const x = (window.innerWidth - windowWidth) / 2;
    const y = (window.innerHeight - windowHeight) / 2;
    
    return { x, y };
});

const pokemon = ref("");
const finished = ref(true);
const gametime = ref("0:00:00");
const realtime = ref("0:00:00.00");
const level = ref("-1");
const resets = ref("-1");
const blackouts = ref("-1");

const numAttempts = ref("-1");
const numFinishes = ref("-1");
const releasedate = ref("1970-01-01");

function populateData() {
    const activeTierlist = tierlist.activeTierlist;
    const entry = activeTierlist.entries[tierlist.activePkmn];

    if (entry === undefined) {
        attemptIndex.value = 0;
        maxAttemptIndex.value = 0;
        return;
    }

    if (tierlist.activePkmn !== pokemon.value) {
        pokemon.value = tierlist.activePkmn;
        attemptIndex.value = 0;
        maxAttemptIndex.value = entry.attempts.length;
    }

    // Check if there are no attempts after updating maxAttemptIndex
    if (entry.attempts.length === 0) {
        maxAttemptIndex.value = 0;
        return;
    }

    const attempt = entry.attempts[attemptIndex.value] ?? {
        finished: false,
        gametime: -1,
        realtime: -1,
        level: -1,
        resets: -1,
        blackouts: -1
    };

    numAttempts.value = entry.numAttempts.toString() ?? "-1";
    numFinishes.value = entry.numFinishes.toString() ?? "-1";
    tags.value = entry.tags ?? [];

    releasedate.value = formatDate(attempt.releasedate);
    finished.value = attempt.finished === 1;
    gametime.value = formatTimeHMS(attempt.gametime);
    realtime.value = formatTimeFull(attempt.realtime);
    level.value = attempt.level.toString();
    resets.value = attempt.resets.toString();
    blackouts.value = attempt.blackouts.toString();
}

watch([() => tierlist.activePkmn, attemptIndex], populateData);

// Watch for when the window becomes visible to populate data immediately
watch(() => props.visible, (visible) => {
    if (visible) {
        populateData();
    }
});

function incIndex() {
    attemptIndex.value = Math.min(attemptIndex.value + 1, maxAttemptIndex.value - 1);
}
function decIndex() {
    attemptIndex.value = Math.max(attemptIndex.value - 1, 0);
}

function updateMetric() {
    const gametimeRegex = new RegExp("^" + GAMETIME_PATTERN + "$");
    const realtimeRegex = new RegExp("^" + REALTIME_PATTERN + "$");

    if (!gametimeRegex.test(gametime.value)) {
        alert("Invalid game time format");
        return;
    }
    if (!realtimeRegex.test(realtime.value)) {
        alert("Invalid real time format");
        return;
    }

    const activeTierlist = tierlist.activeTierlist;
    const entry = activeTierlist.entries[pokemon.value];

    if (entry === undefined) {
        console.error("Entry not found", pokemon.value);
        return;
    }

    entry.numAttempts = parseInt(numAttempts.value);
    entry.numFinishes = parseInt(numFinishes.value);
    entry.tags = tags.value.slice();

    const attempt = entry.attempts[attemptIndex.value];

    if (attempt === undefined) {
        console.error("Attempt not found", pokemon.value, attemptIndex.value);
        return;
    }

    attempt.releasedate = parseDate(releasedate.value);
    attempt.finished = finished.value ? 1 : 0;
    attempt.gametime = parseTime(gametime.value);
    attempt.realtime = parseTime(realtime.value);
    attempt.level = parseInt(level.value);
    attempt.resets = parseInt(resets.value);
    attempt.blackouts = parseInt(blackouts.value);
}

function deleteRun() {
    if (!confirm("Would you really like to delete this run's data?")) {
        return;
    }

    const activeTierlist = tierlist.activeTierlist;
    const entry = activeTierlist.entries[pokemon.value];

    if (entry === undefined) {
        console.error("Entry not found", pokemon.value);
        return;
    }

    // Remove the attempt at the current index
    entry.attempts.splice(attemptIndex.value, 1);
    
    // Update maxAttemptIndex
    maxAttemptIndex.value = entry.attempts.length;
    
    // Adjust attemptIndex if needed (if we deleted the last item, move back)
    if (attemptIndex.value >= maxAttemptIndex.value) {
        attemptIndex.value = maxAttemptIndex.value > 0 ? maxAttemptIndex.value - 1 : 0;
    }
    
    // Repopulate the form with the new current attempt (or show empty state if no attempts left)
    populateData();
}
</script>


<template>
    <Window title="Edit Metrics" :visible="visible" :width="400" @close="$emit('close')" :custom-position="centeredPosition">
        <div v-if="maxAttemptIndex == 0" style="width: 100%; text-align: center; padding: 20px;">
            Select a Pokemon to edit metrics
        </div>
        <table v-else>
            <tbody>
            <tr><td colspan="2" >{{ pokemon }}</td></tr>

            <tr><td colspan="2" height="14px"></td></tr>

            <tr>
                <td><label for="edit_metric_x1"># of Attempts</label></td>
                <td><input id="edit_metric_x1" type="number" v-model="numAttempts" min="0"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_x2"># of Finished</label></td>
                <td><input id="edit_metric_x2" type="number" v-model="numFinishes" min="0"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_x3">Tags</label></td>
                <td><DropdownSelect v-model="tags" :options="tierlist.activeTagList" :allow-other="true"/></td>
            </tr>

            <tr><td colspan="2" height="14px"></td></tr>

            <tr>
                <td><label for="edit_metric_x0">Release Date</label></td>
                <td><input id="edit_metric_x0" type="date" v-model="releasedate"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_a">Finished</label></td>
                <td><input id="edit_metric_a" type="checkbox" v-model="finished"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_b">Game Time</label></td>
                <td><input id="edit_metric_b" type="text" v-model="gametime" :pattern="GAMETIME_PATTERN"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_c">Real Time</label></td>
                <td><input id="edit_metric_c" type="text" v-model="realtime" :pattern="REALTIME_PATTERN"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_d">Level</label></td>
                <td><input id="edit_metric_d" type="number" v-model="level" min="-1" max="100"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_e">Resets</label></td>
                <td><input id="edit_metric_e" type="number" v-model="resets" min="-1"/></td>
            </tr>
            <tr>
                <td><label for="edit_metric_g">Blackouts</label></td>
                <td><input id="edit_metric_g" type="number" v-model="blackouts" min="-1"/></td>
            </tr>

            <tr><td colspan="2" height="14px"></td></tr>

            <tr>
                <td>
                    <button @click="decIndex()">&lt;</button>
                    {{ attemptIndex+1 }}/{{ maxAttemptIndex }}
                    <button @click="incIndex()">&gt;</button>
                    <button class="delete-btn" @click="deleteRun()" title="Delete this run">🗑</button>
                </td>
                <td><button class="sumbit" @click="updateMetric()">Update</button></td>
            </tr>
            </tbody>
        </table>
    </Window>
</template>


<style scoped>
table {
    width: 100%;
}
tr td:nth-child(1)[colspan="2"] {
    text-align: center;
}
tr td:nth-child(2) {
    padding-left: 20px;
    padding-block: 4px;
    text-align: center;
}
input {
    padding: 5px 10px;
    height: 30px;
    width: 100%;
}
button {

    padding: 5px 5px;
    height: 30px;
}
button.sumbit {

    padding: 5px 10px;
    height: 30px;
    width: 100%;
}
button.delete-btn {
    padding: 5px 8px;
    height: 30px;
    margin-left: 5px;
    background-color: #d32f2f;
    color: white;
    border: 1px solid #b71c1c;
    cursor: pointer;
}
button.delete-btn:hover {
    background-color: #b71c1c;
}
input:invalid {
    background-color: #f004;
}
</style>
