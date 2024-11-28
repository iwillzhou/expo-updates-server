# Custom Expo Updates Server & Client

This repo contains a server and client that implement the [Expo Updates protocol specification](https://docs.expo.dev/technical-specs/expo-updates-0).

## Getting started

### Updates overview

To understand this repo, it's important to understand some terminology around updates:

- **Runtime version**: Type: String. Runtime version specifies the version of the underlying native code your app is running. You'll want to update the runtime version of an update when it relies on new or changed native code, like when you update the Expo SDK, or add in any native modules into your apps. Failing to update an update's runtime version will cause your end-user's app to crash if the update relies on native code the end-user is not running.
- **Platform**: Type: "ios" or "android". Specifies which platform to to provide an update.
- **Manifest**: Described in the protocol. The manifest is an object that describes assets and other details that an Expo app needs to know to load an update.

### How the `expo-update-server` works

The flow for creating an update is as follows:

1. Configure and build a "release" version of an app, then run it on a simulator or deploy to an app store.
2. Run the project locally, make changes, then export the app as an update.
3. In the server repo, we'll copy the update made in #2 to the **expo-update-server/updates** directory, under a corresponding runtime version sub-directory.
4. In the "release" app, force close and reopen the app to make a request for an update from the custom update server. The server will return a manifest that matches the requests platform and runtime version.
5. Once the "release" app receives the manifest, it will then make requests for each asset, which will also be served from this server.
6. Once the app has all the required assets it needs from the server, it will load the update.

## The setup

Note: The app is configured to load updates from the server running at http://localhost:3000. If you prefer to load them from a different base URL (for example, in an Android emulator):
1. Update `.env.local` in the server.
2. Update `updates.url` in `app.json` and re-run the build steps below.

### Create a "release" app

The example Expo project configured for the server is located in **/expo-updates-client**.

#### iOS

Run `pnpm` and `pnpm ios --configuration Release`.

#### Android

Run `pnpm` and then run `pnpm android --variant release`.

### Make a change

Let's make a change to the project in /expo-updates-client that we'll want to push as an over-the-air update from our custom server to the "release" app. `cd` in to **/expo-updates-client**, then make a change in **App.js**.

Once you've made a change you're happy with, inside of **/expo-updates-server**, run `pnpm expo-publish`. Under the hood, this script runs `npx expo export` in the client, copies the exported app to the server, and then copies the Expo config to the server as well.

### Send an update

Now we're ready to run the update server. Run `pnpm dev` in the server folder of this repo to start the server.

In the simulator running the "release" version of the app, force close the app and re-open it. It should make a request to /api/manifest, then requests to /api/assets. After the app loads, it should show any changes you made locally.

## About this server

This server was created with NextJS. You can find the API endpoints in **pages/api/manifest.js** and **pages/api/assets.js**.

The code signing keys and certificates were generated using https://github.com/expo/code-signing-certificates.
