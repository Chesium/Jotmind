import { LoginInput } from "@/app/login";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SplashScreen, useRouter } from "expo-router";
import { createContext, PropsWithChildren, useEffect, useState } from "react";
import { connectToNeo4j } from "./neo4jconnector";
import { Driver, Session } from "neo4j-driver";
import useCardViewStore from "./CardViewStore";

SplashScreen.preventAutoHideAsync();

type AuthState = {
  isLoggedIn: boolean;
  isReady: boolean;
  driver: Driver | null;
  session: Session | null;
  userName: string;
  logIn: (info: LoginInput) => void;
  logOut: () => void;
};

const authStorageKey = "auth-key";

export const AuthContext = createContext<AuthState>({
  isLoggedIn: false,
  isReady: false,
  driver: null,
  session: null,
  userName: "",
  logIn: () => {},
  logOut: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState<string>("");
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
  const initMap = (session: Session) => {
    _fetchMap(session);
    // clear();
  };

  const connectToBackend = async (info: LoginInput) => {
    var driver = await connectToNeo4j({
      url: "neo4j+s://88964078.databases.neo4j.io",
      username: "neo4j",
      password: "dwYzcQjWVcdltn3CuFjXOOlexAqucW51BTEHCmm7llg",
    });
    setUserName(info.username);
    var currentSession = driver.session();
    setDriverSession([driver, currentSession]);
    initMap(currentSession);
  };

  const logIn = async (info: LoginInput) => {
    setIsLoggedIn(true);
    storeAuthState({ isLoggedIn: true, info: info });
    await connectToBackend(info);
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
          await connectToBackend(auth.info);
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
        userName,
        driver: driverSession[0],
        session: driverSession[1],
        logIn,
        logOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
