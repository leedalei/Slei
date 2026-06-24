declare module "jsdom" {
  export type ConstructorOptions = {
    url?: string;
    [key: string]: unknown;
  };

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    window: Window;
  }
}
