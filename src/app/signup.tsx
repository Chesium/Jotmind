import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { AuthContext } from "@/utils/authContext";
import { useRouter } from "expo-router";
import { useContext, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useForm, SubmitHandler, Controller } from "react-hook-form";

type SignupInput = {
  username: string;
  password: string;
};

export default function LoginScreen() {
  const router = useRouter();
  const authContext = useContext(AuthContext);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput>({
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const [submittedData, setSubmittedData] = useState<SignupInput | null>(null);
  const [loginError, setLoginError] = useState<string | undefined>(undefined);

  const onSubmit: SubmitHandler<SignupInput> = async (data) => {
    // Simulate form submission
    console.log("Submitted Data:", data);
    setSubmittedData(data);
    setLoginError(undefined);
    try {
      await authContext.connector.createUser(data.username, data.password);
      authContext.logIn(data);
    } catch (e) {
      setLoginError((e as Error).message);
    }
  };

  useEffect(() => {
    authContext.connector.connectToNeo4j();
  }, []);

  return (
    <View className="flex-1 justify-center p-4">
      <AppText size="heading" center className="font-bold">
        Sign up
      </AppText>
      <View style={styles.container}>
        <Text className="font-semibold">UserName</Text>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="UserName"
              onBlur={onBlur}
              onChangeText={(e) => {
                setLoginError(undefined);
                onChange(e);
              }}
              value={value}
            />
          )}
          name="username"
        />
        {errors.username && <Text>This is required.</Text>}

        <Text className="font-semibold">Password</Text>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Password"
              onBlur={onBlur}
              onChangeText={(e) => {
                setLoginError(undefined);
                onChange(e);
              }}
              value={value}
            />
          )}
          name="password"
        />
        {errors.password && <Text>This is required.</Text>}

        {loginError && <Text className="text-red">{loginError}</Text>}

        <Button title="Submit" onPress={handleSubmit(onSubmit)} />

        {submittedData && (
          <View style={styles.submittedContainer}>
            <Text style={styles.submittedTitle}>
              Logging In - Submitted Data:
            </Text>
            <Text>UserName: {submittedData.username}</Text>
            <Text>Password: {submittedData.password}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  submittedContainer: {},
  submittedTitle: {},
  container: {
    padding: 16,
  },
  input: {
    height: 40,
    borderColor: "gray",
    borderWidth: 1,
    marginBottom: 10,
    padding: 8,
  },
  errorText: {
    color: "red",
    marginBottom: 10,
  },
});
