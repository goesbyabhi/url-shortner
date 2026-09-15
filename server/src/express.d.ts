/**
 * `requireAuth` attaches the resolved owner to the request. This augmentation
 * makes it typed everywhere; it is optional because unauthenticated routes
 * (redirects, health) don't have one.
 */
declare global {
  namespace Express {
    interface Request {
      ownerId?: number;
    }
  }
}

export {};
