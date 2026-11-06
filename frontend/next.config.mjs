/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // The console had three pages with nothing behind them but a "coming soon"
    // panel. Access and invoicing are arranged with each organisation, so these
    // addresses lead back to the overview.
    //
    // Here rather than in the pages: the console checks the session before it
    // renders anything, so a redirect inside a page never ran for someone not
    // signed in, and the address stayed on an empty screen.
    return ["billing", "settings", "usage"].map((page) => ({
      source: `/app/${page}`,
      destination: "/app",
      permanent: false,
    }));
  },
};

export default nextConfig;
