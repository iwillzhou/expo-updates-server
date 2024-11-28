while getopts d: flag
do
    case "${flag}" in
        d) directory=${OPTARG};;
    esac
done

cd ../../test-app
npx expo export
cd ../custom-expo-updates-server/expo-updates-server
rm -rf updates/$directory/
cp -r ../../test-app/dist/ updates/$directory

npx expo config ../../test-app --json > updates/$directory/expoConfig.json
