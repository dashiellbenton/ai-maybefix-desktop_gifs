# Desktop GIFs probe

A throwaway diagnostic for upstream issue #93, not part of the extension. It
tries the GIF comment request YouTube now refuses from desktop in several
variants and reports how YouTube answers each one.

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
   Turning Desktop GIFs off while probing keeps the two out of each other's way.
2. Open any video (preferably your own or an unlisted one), refresh the tab.
3. In the black panel bottom left, click **Arm**.
4. Write a short test comment such as `test` and press YouTube's **Comment** button.
5. Wait for "Done", then **Copy report**.

The variants, in order: the request as the page sends it (WEB) with the GIF;
the mobile website client (MWEB); the Android app client; the Android app
client with its User-Agent; the iOS app client with its User-Agent. The probe
stops at the first one YouTube does not refuse, so at most one comment is
posted. Each is a full post attempt with your test text and the GIF.

The report holds the request's field and header names, the page's client name
and version, and YouTube's answers. It holds no cookies, auth header values or
comment text. It also lists every place in the page's YouTube data whose name
or text mentions GIFs or Tenor (`gifLeads`), as a hint of how YouTube's own
clients attach one; open a video's comments before posting so those load.
