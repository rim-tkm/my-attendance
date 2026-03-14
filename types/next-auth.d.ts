import "next-auth";

declare module "next-auth" {
  interface User {
    id?: string;
    loginId?: string;
    name?: string | null;
  }

  interface Session {
    user: {
      id: string;
      loginId?: string;
      name?: string | null;
      image?: string | null;
    };
  }
}
