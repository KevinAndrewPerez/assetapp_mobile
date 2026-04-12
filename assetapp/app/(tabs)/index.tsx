import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  const [data, setData] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Replace with your actual IP address if different
    fetch('http://192.168.1.5:80/api/test-endpoint')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(json => setData(json.message))
      .catch(error => {
        console.error('Fetch error:', error);
        setError(error.message);
      });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>
        {data ? `Laravel says: ${data}` : error ? `Error: ${error}` : 'Loading...'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  text: {
    color: '#000000',
    fontSize: 18,
    textAlign: 'center',
  },
});