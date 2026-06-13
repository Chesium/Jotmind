## Errors
- 环境变量读取不了：vscode重启需要关闭所有窗口才彻底

> `[CXX1101] NDK at C:\Users\chesi\AppData\Local\Android\Sdk\ndk\27.1.12297006 did not have a source.properties file`

没有安装好ndk：Android Studio > Settings > Languages & Frameworks > Android SDK > SDK Tools：安装“NDK (Side by Side)” [参考](https://blog.csdn.net/shadowfall/article/details/122114901)

> `The server may not support the client's requested TLS protocol versions: (TLSv1.2, TLSv1.3). You may need to configure the client to allow other protocols to be used.`

往`android > gradle.properties` 中添加一行：
```
systemProp.jdk.tls.client.protocols=TLSv1.2,TLSv1.3
```
[参考](https://blog.csdn.net/sondx/article/details/140823893)

后面奇怪地又出现了一次相同错误，不过原封不动重新运行成功了

metro bundle 时报错说找不到 `react-native-safe-area-context`，关掉metro重新来解决了

typescript 的`navigation.navigate` 报错说参数类型是`never`：在 `RootStack` 代码后添加：
```typescript
type RootStackParamList = StaticParamList<typeof RootStack>;  
  
declare global {  
	namespace ReactNavigation {  
		interface RootParamList extends RootStackParamList {}  
	}  
}
```
[参考](https://reactnavigation.org/docs/typescript/?config=static#combining-navigation-props)

typescript 找不到 `navigation.push` ：将获取navigation hook的代码改成
```typescript
const navigation = useNavigation<NativeStackNavigationProp<any>>();
```
[参考](https://github.com/react-navigation/react-navigation/issues/9037#issuecomment-2245477085)
## React Native

[React Native Directory](https://reactnative.directory/)

| React Native UI | WEB HTML-Tag          | 说明                                  |
| --------------- | --------------------- | ----------------------------------- |
| `<View>`        | non-scrolling `<div>` | 一个支持使用flexbox布局、样式、一些触摸处理和无障碍性控件的容器 |
| `<Text>`        | `<p>`                 | 显示、样式和嵌套文本字符串，甚至处理触摸事件              |
| `<Image>`       | `<img>`               | 显示不同类型的图片                           |
| `<ScrollView>`  | `<div>`               | 一个通用的滚动容器，可以包含多个组件和视图               |
| `<TextInput>`   | `<input type="text">` | 使用户可以输入文本                           |
