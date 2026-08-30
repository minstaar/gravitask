import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // 버전을 빌드 시점에 심습니다.
  //
  // 실행 중에 물어보는 방법도 있지만 그건 권한과 비동기 호출이 걸립니다.
  // 버전은 빌드가 끝나는 순간 이미 정해져 있는 값이라 물어볼 이유가 없습니다.
  // package.json 하나가 진실 공급원인 것도 그대로 지켜집니다.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
