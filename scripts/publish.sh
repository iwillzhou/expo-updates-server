while getopts d: flag
do
    case "${flag}" in
        d) directory=${OPTARG};;
    esac
done

cd ../app-init
npx expo export
cd ../expo-updates-server
rm -rf updates/$directory/
cp -r ../app-init/dist/ updates/$directory

npx expo config ../app-init --json > updates/$directory/expoConfig.json
