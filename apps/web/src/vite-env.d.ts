/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATAPIPE_SOCKET_PATH?: string;
  readonly VITE_DATAPIPE_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
