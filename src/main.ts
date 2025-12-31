import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import './extention'
import App from './app/App.vue'

import { PiniaPersistStatePlugin } from './store/pinia-persist-state-plugin'

const pinia = createPinia();
pinia.use(PiniaPersistStatePlugin);

const app = createApp(App);
app.use(pinia);
app.mount('#app');
