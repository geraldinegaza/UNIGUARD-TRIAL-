// Editor-only type declarations for the Edge Functions (Deno runtime).
// Deno provides these at run time; this file only stops VS Code from
// flagging them. It is not deployed and does not change any behaviour.

declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}

// Deno's "npm:" imports, mapped to the same packages for the editor
declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:web-push@3.6.7' {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload?: string,
      options?: Record<string, unknown>
    ): Promise<unknown>;
  };
  export default webpush;
}
