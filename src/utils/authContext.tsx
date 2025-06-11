import { LoginInput } from "@/app/login";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SplashScreen, useRouter } from "expo-router";
import { createContext, PropsWithChildren, useEffect, useState } from "react";
import { Driver, Session } from "neo4j-driver";
import useCardViewStore from "./CardViewStore";
import _connector, { Neo4jConnector } from "./neo4juserCtrl";

SplashScreen.preventAutoHideAsync();

type AuthState = {
  isLoggedIn: boolean;
  isReady: boolean;
  connector: Neo4jConnector;
  username: string | null;
  logIn: (info: LoginInput) => void;
  logOut: () => void;
};

const authStorageKey = "auth-key";

export const AuthContext = createContext<AuthState>({
  isLoggedIn: false,
  isReady: false,
  connector: _connector,
  username: null,
  logIn: () => {},
  logOut: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [driverSession, setDriverSession] = useState<
    [Driver | null, Session | null]
  >([null, null]);
  const router = useRouter();

  const storeAuthState = async (newState: {
    isLoggedIn: boolean;
    info: LoginInput;
  }) => {
    try {
      const jsonValue = JSON.stringify(newState);
      await AsyncStorage.setItem(authStorageKey, jsonValue);
    } catch (error) {
      console.log("Error saving", error);
    }
  };

  const _fetchMap = useCardViewStore((state) => state.fetchMap);
  // const { clear } = useCardViewStore.temporal.getState();
  const initMap = () => {
    _fetchMap(_connector);
    // clear();
  };

  const connectToBackend = async (info: LoginInput) => {
    await _connector.connectToNeo4j();
    await _connector.logIn(info.username, info.password);
    _connector.addEventListener("changed username", (ev) => {
      setUsername(ev.name);
    });
    setUsername(info.username);
    initMap();
  };

  const logIn = async (info: LoginInput) => {
    setIsLoggedIn(true);
    await connectToBackend(info);
    storeAuthState({ isLoggedIn: true, info: info });
    router.replace("/");
  };

  const logOut = () => {
    setIsLoggedIn(false);
    storeAuthState({ isLoggedIn: false, info: { username: "", password: "" } });
    router.replace("/login");
  };

  useEffect(() => {
    const getAuthFromStorage = async () => {
      // simulate a delay, e.g. for an API request
      await new Promise((res) => setTimeout(() => res(null), 1000));
      try {
        const value = await AsyncStorage.getItem(authStorageKey);
        if (value !== null) {
          const auth = JSON.parse(value);
          console.log(`getAuthFromStorage:`);
          console.log(auth);
          if (auth.isLoggedIn == true) {
            await connectToBackend(auth.info);
          }
          setIsLoggedIn(auth.isLoggedIn);
        }
      } catch (error) {
        console.log("Error fetching from storage", error);
      }
      setIsReady(true);
    };
    getAuthFromStorage();
  }, []);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  return (
    <AuthContext.Provider
      value={{
        isReady,
        isLoggedIn,
        connector: _connector,
        username,
        logIn,
        logOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
