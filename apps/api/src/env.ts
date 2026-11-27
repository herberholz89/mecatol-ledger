export interface Bindings {
  DATABASE_URL: string;
  ASSETS: Fetcher;
}

export interface AppEnv {
  Bindings: Bindings;
}
