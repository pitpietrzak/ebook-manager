# Setting up Backend Services

To make this app work, we need to set up Supabase (for our database and edge functions) and Google Cloud (for Google Drive access and Sign-In).

## 1. Supabase Setup
1. Go to [database.new](https://database.new) and create a new project.
2. Once the project is provisioned, go to the **SQL Editor** in the left sidebar.
3. Open the file `supabase/schema.sql` located in your `ebook-manager` folder.
4. Copy the entire content and paste it into the SQL Editor, then click **Run**. This will create the `books` table, enable the `pgvector` extension for AI search, and set up Row Level Security.
5. In your Supabase dashboard, go to **Project Settings -> API** and copy the **Project URL** and the **anon public anon key**. We will need these for the app.

## 2. Google Cloud Platform Setup (OAuth & Drive API)
Since we need to access Google Drive, we need to authenticate users. With Expo, it is easiest to create an OAuth Client.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top and select **New Project**. Name it "Family Ebook Manager".
3. Once created, select the project. Switch to the **APIs & Services** dashboard.
4. **Enable APIs**: 
   - Click "Enable APIs and Services".
   - Search for **Google Drive API** and click Enable.
5. **OAuth Consent Screen**:
   - Go to "OAuth consent screen" on the left menu.
   - Choose **External** (unless you have a Google Workspace for your family, then Internal).
   - Fill in the required fields (App name, support email, developer contact email).
   - Click **Save and Continue**. Skip scoping for now, add test users if necessary.
6. **Create Credentials**:
   - Go to **Credentials** on the left menu.
   - Click **Create Credentials** at the top -> **OAuth client ID**.
   - **Application Type**: Select **Web application** (Expo AuthSession uses this for its Web proxy on iOS/Android during development).
   - **Name**: "Expo Proxy"
   - **Authorized redirect URIs**: Add `https://auth.expo.io/@your-expo-username/ebook-manager` (We will determine the exact URL when we build the auth module). For now, you can leave it blank or add `http://localhost`.
   - Also create another **OAuth client ID** for Application Type: **iOS** and **Android** if you plan to build standalone apps later. For development in Expo Go, the Web client id is sufficient with Expo Auth proxy.
7. Note down the **Client ID**.

## 3. Environment Variables
Create a file named `.env` in the root of the `ebook-manager` folder and add these lines:
```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_google_web_client_id
EXPO_PUBLIC_OPENAI_API_KEY=your_openai_api_key
```

Once you have done these steps, we can move forward with writing the application code!
