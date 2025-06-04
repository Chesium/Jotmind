import * as React from 'react';
import {StyleSheet, ScrollView} from 'react-native';
import type {expandedNodeData, neo4jLoginInfo} from './dataType';
import PersonCard, {OnFocus} from './personCard';
import {connectToNeo4j, retrieveInfo} from './neo4jconnector';
import {
  StaticParamList,
  StaticScreenProps,
  useNavigation,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {PersonFocus} from './personFocus';
import {Session} from 'neo4j-driver';

export default function PersonCardView({
  data,
  onFocus,
}: {
  data: expandedNodeData[];
  onFocus: OnFocus;
}) {
  return (
    <ScrollView contentContainerStyle={style.scrollContainer}>
      {data.map((nodeData, i) => (
        <PersonCard
          data={nodeData}
          key={`PersonCard${i}`}
          onFocus={onFocus}></PersonCard>
      ))}
    </ScrollView>
  );
}

export type PersonCardViewFromNeo4jProps = StaticScreenProps<{
  neo4jinfo: neo4jLoginInfo;
}>;

export function PersonCardViewFromNeo4j({route}: PersonCardViewFromNeo4jProps) {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  var [session, setSession] = React.useState<Session | null>(null);
  var [data, setdata] = React.useState<expandedNodeData[]>([]);

  React.useEffect(() => {
    async function init() {
      var driver = await connectToNeo4j(route.params.neo4jinfo);
      var currentSession = driver.session();
      setSession(currentSession);
      var nodelist = (await retrieveInfo(currentSession)) as expandedNodeData[];
      console.log(nodelist);
      setdata(nodelist);
    }

    if (data.length == 0) {
      // actually it will only run once
      init();
    }
  }, []);

  return (
    <PersonCardView
      data={data}
      onFocus={neo4jId => {
        navigation.navigate('Focus', {session: session, elementId: neo4jId});
      }}></PersonCardView>
  );
}

export const CardStack = createNativeStackNavigator({
  screens: {
    Cards: {
      screen: PersonCardViewFromNeo4j,
      options: {
        headerBackTitle: 'Cards',
      },
      initialParams: {
        neo4jinfo: {
          url: 'neo4j+s://88964078.databases.neo4j.io',
          username: 'neo4j',
          password: 'dwYzcQjWVcdltn3CuFjXOOlexAqucW51BTEHCmm7llg',
        },
      },
    },
    Focus: PersonFocus,
  },
});

type CardStackParamList = StaticParamList<typeof CardStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends CardStackParamList {}
  }
}

// export const CardStackNavigation = createStaticNavigation(CardStack);

const style = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 20,
  },
});
