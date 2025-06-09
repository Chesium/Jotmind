import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { AuthContext } from "@/utils/authContext";
import { useRouter } from "expo-router";
import { useContext, useState } from "react";
import { SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useForm, SubmitHandler, Controller } from "react-hook-form";

export type LoginInput = {
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
  } = useForm<LoginInput>({
    defaultValues: {
      username: "DemoUser",
      password: "123456",
    },
  });
  // const onSubmit: SubmitHandler<LoginInput> = (data) => authContext.logIn(data);
  const [submittedData, setSubmittedData] = useState<LoginInput | null>(null);

  const onSubmit: SubmitHandler<LoginInput> = (data) => {
    // Simulate form submission
    console.log("Submitted Data:", data);
    setSubmittedData(data);
    authContext.logIn(data);
  };

  return (
    <View className="flex-1 justify-center p-4">
      <AppText size="heading" center>
        Login Screen
      </AppText>
      <View style={styles.container}>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="First name"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
            />
          )}
          name="username"
        />
        {errors.username && <Text>This is required.</Text>}

        <Controller
          control={control}
          rules={{
            maxLength: 100,
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Last name"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
            />
          )}
          name="password"
        />

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
      {/* <Button title="Log in" onPress={authContext.logIn} /> */}
      <Button title="Sign Up" onPress={() => router.push("/signup")} />
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
